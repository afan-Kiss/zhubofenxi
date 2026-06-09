import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import { truncateUrlForLog, getDownloadDir, getMaxDownloadBytes } from '../config/env'
import {
  DOWNLOAD_TYPE_LABELS,
  DOWNLOAD_TYPES,
  type DownloadType,
  isDownloadType,
} from '../types/download'
import { getDecryptedCookie } from './credential.service'
import type { DateRangeResolved } from '../utils/date-range'
import {
  getDownloadConfig,
  getEnabledDownloadConfig,
  isDownloadTypeAvailable,
  isDownloadTypeEnabled,
  isValidDirectDownloadUrl,
  getEffectiveDownloadMode,
  resolveLiveSellerId,
} from './downloadConfig.service'
import { writeOperationLog } from './audit.service'
import type { DownloadProgressContext } from '../types/download-batch'
import { normalizeDownloadError } from '../utils/download-errors'
import { exportXhsLiveSessionsByMonth, exportXhsOrderByRange } from './xhs-export.service'
import { exportXhsPendingBillByRange, exportXhsSettledBillByRange } from './xhs-settlement-export.service'
import { updateDownloadTaskStep } from './download-task-progress.service'
import { findUserById } from './user.service'
import {
  failedPhaseFromStep,
  initDownloadPipeline,
  parsePipelineMeta,
  patchDownloadPipeline,
  toPipelineView,
} from './download-pipeline-meta.service'
import {
  loadOrderApiDebug,
  orderDiagnosticsToView,
} from './xhs-order-export-diagnostics.service'
import {
  liveDiagnosticsToView,
  loadTaskApiDebug,
} from './download-task-api-debug.service'

export interface DownloadRunOptions {
  batchId?: string
  taskId?: string
  progress?: DownloadProgressContext
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const ACCEPT_EXCEL =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,*/*'

export interface DownloadTaskView {
  id: string
  type: DownloadType
  typeLabel: string
  mode: string | null
  taskId: string | null
  status: string
  fileName: string | null
  fileSize: number | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface DownloadTaskDetailView extends DownloadTaskView {
  step: string | null
  pipeline: ReturnType<typeof toPipelineView> | null
  orderDiagnostics: ReturnType<typeof orderDiagnosticsToView> | null
  liveDiagnostics: ReturnType<typeof liveDiagnosticsToView> | null
}

function toTaskView(row: {
  id: string
  type: string
  mode: string | null
  xhsTaskId: string | null
  status: string
  fileName: string | null
  fileSize: number | null
  errorMessage: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
}): DownloadTaskView {
  const type = isDownloadType(row.type) ? row.type : 'order'
  return {
    id: row.id,
    type,
    typeLabel: DOWNLOAD_TYPE_LABELS[type],
    mode: row.mode,
    taskId: row.xhsTaskId,
    status: row.status,
    fileName: row.fileName,
    fileSize: row.fileSize,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function yearMonthFromRange(range: DateRangeResolved): { year: number; month: number } {
  const [y, m] = range.startDate.split('-').map(Number)
  return { year: y, month: m }
}

function looksLikeHtml(buffer: Buffer, contentType: string): boolean {
  const ct = contentType.toLowerCase()
  if (ct.includes('text/html')) return true
  const head = buffer.subarray(0, 512).toString('utf8').trim().toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<login')
}

function looksLikeExcel(buffer: Buffer, contentType: string): boolean {
  const ct = contentType.toLowerCase()
  if (
    ct.includes('spreadsheetml') ||
    ct.includes('ms-excel') ||
    ct.includes('application/octet-stream')
  ) {
    return true
  }
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return true
  if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf) return true
  return false
}

function parseFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback
  const match = /filename\*?=((?:UTF-8''|")?)([^";\n]+)/i.exec(contentDisposition)
  if (match?.[2]) {
    try {
      return decodeURIComponent(match[2].replace(/"/g, '').trim())
    } catch {
      return match[2].replace(/"/g, '').trim()
    }
  }
  return fallback
}

function extFromContentType(contentType: string): string {
  if (contentType.includes('spreadsheetml')) return '.xlsx'
  if (contentType.includes('ms-excel')) return '.xls'
  return '.xlsx'
}

async function failTask(
  taskId: string,
  message: string,
  mode?: string,
  type?: DownloadType,
  step?: string | null,
): Promise<DownloadTaskView> {
  const normalized = normalizeDownloadError(new Error(message), type)
  await patchDownloadPipeline(taskId, {
    failedPhase: failedPhaseFromStep(step ?? 'download_file'),
  })
  const row = await prisma.downloadTask.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      step: 'failed',
      errorMessage: normalized,
      finishedAt: new Date(),
      mode: mode ?? undefined,
    },
  })
  return toTaskView(row)
}

async function downloadByDirectUrl(
  type: DownloadType,
  userId: string,
  config: { url: string; method: string },
  mode: 'direct_url',
  audit?: { requestId?: string; ip?: string; userAgent?: string },
  run?: DownloadRunOptions,
): Promise<DownloadTaskView> {
  let cookie: string
  try {
    cookie = await getDecryptedCookie()
  } catch (err) {
    throw new Error(normalizeDownloadError(err, type))
  }

  const task = run?.taskId
    ? await prisma.downloadTask.update({
        where: { id: run.taskId },
        data: {
          type,
          mode,
          status: 'downloading',
          startedAt: new Date(),
          batchId: run.batchId ?? undefined,
        },
      })
    : await prisma.downloadTask.create({
        data: {
          type,
          mode,
          status: 'downloading',
          startedAt: new Date(),
          createdBy: userId,
          requestId: audit?.requestId ?? null,
          batchId: run?.batchId ?? null,
        },
      })

  await initDownloadPipeline(task.id, mode)
  await run?.progress?.setStep('download_file')

  const logUrl = truncateUrlForLog(config.url)
  console.log(`[download] 开始下载 type=${type} mode=${mode} url=${logUrl}`)

  try {
    const maxBytes = getMaxDownloadBytes()
    const res = await fetch(config.url, {
      method: config.method || 'GET',
      headers: {
        Cookie: cookie,
        'User-Agent': BROWSER_UA,
        Accept: ACCEPT_EXCEL,
      },
      redirect: 'follow',
    })

    if (!res.ok) {
      await patchDownloadPipeline(task.id, { apiSuccess: false })
      return failTask(task.id, `下载请求失败，HTTP ${res.status}`, mode, type, 'download_file')
    }

    await patchDownloadPipeline(task.id, {
      apiSuccess: true,
      fileUrlObtained: true,
    })

    const contentLength = Number(res.headers.get('content-length') || 0)
    if (contentLength > maxBytes) {
      return failTask(
        task.id,
        `文件过大（超过 ${Math.floor(maxBytes / 1024 / 1024)}MB 限制），已中断下载`,
        mode,
        type,
        'download_file',
      )
    }

    const buffer = Buffer.from(await res.arrayBuffer())

    if (buffer.length > maxBytes) {
      return failTask(
        task.id,
        `文件过大（超过 ${Math.floor(maxBytes / 1024 / 1024)}MB 限制），已中断下载`,
        mode,
        type,
        'download_file',
      )
    }

    const contentType = res.headers.get('content-type') ?? ''
    const excelErr =
      type === 'live'
        ? '直播场次下载结果不是 Excel，可能 Cookie 失效或接口参数错误'
        : '下载结果不是 Excel，可能 Cookie 失效或下载链接错误'

    await run?.progress?.setStep('validate_file')

    if (looksLikeHtml(buffer, contentType)) {
      return failTask(task.id, excelErr, mode, type, 'validate_file')
    }

    if (!looksLikeExcel(buffer, contentType)) {
      return failTask(task.id, excelErr, mode, type, 'validate_file')
    }

    const dir = getDownloadDir()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fallbackName = `${type}-${stamp}${extFromContentType(contentType)}`
    const fileName = parseFilename(res.headers.get('content-disposition'), fallbackName)
    const safeName = fileName.replace(/[<>:"/\\|?*]/g, '_')
    const filePath = path.join(dir, safeName)

    fs.writeFileSync(filePath, buffer)
    await patchDownloadPipeline(task.id, { xlsxDownloaded: true })

    const updated = await prisma.downloadTask.update({
      where: { id: task.id },
      data: {
        status: 'success',
        fileName: safeName,
        filePath,
        fileSize: buffer.length,
        finishedAt: new Date(),
        errorMessage: null,
        mode,
      },
    })

    console.log(`[download] 成功 type=${type} mode=${mode} file=${safeName}`)

    if (type === 'live') {
      const user = await findUserById(userId)
      await writeOperationLog({
        userId,
        username: user?.username ?? userId,
        role: user?.role ?? 'unknown',
        action: 'live_download_success',
        module: 'download',
        description: `直播场次表下载成功 ${safeName}`,
        meta: { type: 'live', fileName: safeName, fileSize: buffer.length, mode },
        requestId: audit?.requestId,
        ip: audit?.ip,
        userAgent: audit?.userAgent,
      })
    }

    if (type === 'settledSettlement') {
      const user = await findUserById(userId)
      await writeOperationLog({
        userId,
        username: user?.username ?? userId,
        role: user?.role ?? 'unknown',
        action: 'settled_download_success',
        module: 'download',
        description: `已结算明细下载成功 ${safeName}`,
        meta: { type: 'settledSettlement', fileName: safeName, fileSize: buffer.length, mode },
        requestId: audit?.requestId,
        ip: audit?.ip,
        userAgent: audit?.userAgent,
      })
    }

    if (type === 'pendingSettlement') {
      const user = await findUserById(userId)
      await writeOperationLog({
        userId,
        username: user?.username ?? userId,
        role: user?.role ?? 'unknown',
        action: 'pending_download_success',
        module: 'download',
        description: `待结算明细下载成功 ${safeName}`,
        meta: { type: 'pendingSettlement', fileName: safeName, fileSize: buffer.length, mode },
        requestId: audit?.requestId,
        ip: audit?.ip,
        userAgent: audit?.userAgent,
      })
    }

    await run?.progress?.setStep('success')
    return toTaskView(updated)
  } catch (err) {
    const message = normalizeDownloadError(err, type)
    console.error(`[download] 失败 type=${type} url=${logUrl} error=${message}`)
    await run?.progress?.setStep('failed')

    if (type === 'live') {
      const user = await findUserById(userId)
      await writeOperationLog({
        userId,
        username: user?.username ?? userId,
        role: user?.role ?? 'unknown',
        action: 'live_download_failed',
        module: 'download',
        description: `直播场次表下载失败：${message}`,
        meta: { type: 'live', error: message, mode },
        requestId: audit?.requestId,
        ip: audit?.ip,
        userAgent: audit?.userAgent,
      })
    }

    if (type === 'settledSettlement') {
      const user = await findUserById(userId)
      await writeOperationLog({
        userId,
        username: user?.username ?? userId,
        role: user?.role ?? 'unknown',
        action: 'settled_download_failed',
        module: 'download',
        description: `已结算明细下载失败：${message}`,
        meta: { type: 'settledSettlement', errorMessage: message, mode },
        requestId: audit?.requestId,
        ip: audit?.ip,
        userAgent: audit?.userAgent,
      })
    }

    if (type === 'pendingSettlement') {
      const user = await findUserById(userId)
      await writeOperationLog({
        userId,
        username: user?.username ?? userId,
        role: user?.role ?? 'unknown',
        action: 'pending_download_failed',
        module: 'download',
        description: `待结算明细下载失败：${message}`,
        meta: { type: 'pendingSettlement', errorMessage: message, mode },
        requestId: audit?.requestId,
        ip: audit?.ip,
        userAgent: audit?.userAgent,
      })
    }

    const current = await prisma.downloadTask.findUnique({ where: { id: task.id } })
    return failTask(task.id, message, mode, type, current?.step)
  }
}

export async function downloadOrderWithRange(
  userId: string,
  range: DateRangeResolved,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
  run?: DownloadRunOptions,
): Promise<DownloadTaskView> {
  const config = run?.batchId
    ? await getDownloadConfig('order')
    : await getEnabledDownloadConfig('order')
  if (!config) {
    throw new Error('当月订单表未启用或未配置，请在系统设置启用')
  }

  const mode = getEffectiveDownloadMode('order', config)
  if (run?.taskId) {
    await prisma.downloadTask.update({ where: { id: run.taskId }, data: { mode } })
  }
  if (mode === 'direct_url') {
    if (!isValidDirectDownloadUrl(config.url)) {
      throw new Error('请填写临时 xlsx 下载链接')
    }
    return downloadByDirectUrl('order', userId, config, 'direct_url', audit, run)
  }

  const user = await findUserById(userId)
  const result = await exportXhsOrderByRange({
    range,
    userId,
    username: user?.username ?? userId,
    role: user?.role ?? 'unknown',
    requestId: audit?.requestId,
    ip: audit?.ip,
    userAgent: audit?.userAgent,
    progress: run?.progress,
  })

  const taskId = run?.taskId ?? result.downloadTaskId
  const row = await prisma.downloadTask.findUnique({ where: { id: taskId } })
  if (!row) throw new Error('下载任务记录丢失')
  return toTaskView(row)
}

export async function downloadLiveWithRange(
  userId: string,
  range: DateRangeResolved,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
  run?: DownloadRunOptions,
): Promise<DownloadTaskView> {
  const config = run?.batchId
    ? await getDownloadConfig('live')
    : await getEnabledDownloadConfig('live')
  if (!config) {
    throw new Error('直播场次表未启用或未配置')
  }

  const mode = getEffectiveDownloadMode('live', config)
  if (run?.taskId) {
    await prisma.downloadTask.update({ where: { id: run.taskId }, data: { mode } })
  }
  if (mode === 'direct_url') {
    if (!isValidDirectDownloadUrl(config.url)) {
      throw new Error('请填写临时 xlsx 下载链接')
    }
    return downloadByDirectUrl('live', userId, config, 'direct_url', audit, run)
  }

  const { year, month } = yearMonthFromRange(range)
  const sellerId = resolveLiveSellerId(config.sellerId)
  const user = await findUserById(userId)

  const result = await exportXhsLiveSessionsByMonth({
    year,
    month,
    userId,
    username: user?.username ?? userId,
    role: user?.role ?? 'unknown',
    sellerId,
    requestId: audit?.requestId,
    ip: audit?.ip,
    userAgent: audit?.userAgent,
    progress: run?.progress,
  })

  const taskId = run?.taskId ?? result.downloadTaskId
  const row = await prisma.downloadTask.findUnique({ where: { id: taskId } })
  if (!row) throw new Error('下载任务记录丢失')
  return toTaskView(row)
}

export async function downloadSettledWithRange(
  userId: string,
  range: DateRangeResolved,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
  run?: DownloadRunOptions,
): Promise<DownloadTaskView> {
  const config = run?.batchId
    ? await getDownloadConfig('settledSettlement')
    : await getEnabledDownloadConfig('settledSettlement')
  if (!config) {
    throw new Error('已结算明细未启用或未配置')
  }

  const mode = getEffectiveDownloadMode('settledSettlement', config)
  if (run?.taskId) {
    await prisma.downloadTask.update({ where: { id: run.taskId }, data: { mode } })
  }
  if (mode === 'direct_url') {
    if (!isValidDirectDownloadUrl(config.url)) {
      throw new Error('请填写临时 xlsx 下载链接')
    }
    return downloadByDirectUrl('settledSettlement', userId, config, 'direct_url', audit, run)
  }

  const user = await findUserById(userId)
  const result = await exportXhsSettledBillByRange({
    startDate: range.startDate,
    endDate: range.endDate,
    userId,
    username: user?.username ?? userId,
    role: user?.role ?? 'unknown',
    requestId: audit?.requestId,
    ip: audit?.ip,
    userAgent: audit?.userAgent,
    progress: run?.progress,
  })

  const taskId = run?.taskId ?? result.downloadTaskId
  const row = await prisma.downloadTask.findUnique({ where: { id: taskId } })
  if (!row) throw new Error('下载任务记录丢失')
  return toTaskView(row)
}

export async function downloadPendingWithRange(
  userId: string,
  range: DateRangeResolved,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
  run?: DownloadRunOptions,
): Promise<DownloadTaskView> {
  const config = run?.batchId
    ? await getDownloadConfig('pendingSettlement')
    : await getEnabledDownloadConfig('pendingSettlement')
  if (!config) {
    throw new Error('待结算明细未启用或未配置')
  }

  const mode = getEffectiveDownloadMode('pendingSettlement', config)
  if (run?.taskId) {
    await prisma.downloadTask.update({ where: { id: run.taskId }, data: { mode } })
  }
  if (mode === 'direct_url') {
    if (!isValidDirectDownloadUrl(config.url)) {
      throw new Error('请填写临时 xlsx 下载链接')
    }
    return downloadByDirectUrl('pendingSettlement', userId, config, 'direct_url', audit, run)
  }

  const user = await findUserById(userId)
  const result = await exportXhsPendingBillByRange({
    startDate: range.startDate,
    endDate: range.endDate,
    userId,
    username: user?.username ?? userId,
    role: user?.role ?? 'unknown',
    requestId: audit?.requestId,
    ip: audit?.ip,
    userAgent: audit?.userAgent,
    progress: run?.progress,
  })

  const taskId = run?.taskId ?? result.downloadTaskId
  const row = await prisma.downloadTask.findUnique({ where: { id: taskId } })
  if (!row) throw new Error('下载任务记录丢失')
  return toTaskView(row)
}

export async function downloadByType(
  type: DownloadType,
  userId: string,
  range?: DateRangeResolved,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
  run?: DownloadRunOptions,
): Promise<DownloadTaskView> {
  try {
    if (type === 'order') {
      if (!range) throw new Error('订单表下载需要指定时间范围')
      return await downloadOrderWithRange(userId, range, audit, run)
    }

    if (type === 'live') {
      if (!range) throw new Error('直播场次表下载需要指定时间范围')
      return await downloadLiveWithRange(userId, range, audit, run)
    }

    if (type === 'settledSettlement') {
      if (!range) throw new Error('已结算明细下载需要指定时间范围')
      return await downloadSettledWithRange(userId, range, audit, run)
    }

    if (type === 'pendingSettlement') {
      if (!range) throw new Error('待结算明细下载需要指定时间范围')
      return await downloadPendingWithRange(userId, range, audit, run)
    }

    const config = await getEnabledDownloadConfig(type)
    if (!config) {
      throw new Error(`${DOWNLOAD_TYPE_LABELS[type]} 未启用或未配置下载链接`)
    }

    return await downloadByDirectUrl(type, userId, config, 'direct_url', audit, run)
  } catch (err) {
    if (run?.taskId) {
      const message = normalizeDownloadError(err, type)
      await updateDownloadTaskStep(run.taskId, 'failed', {
        status: 'failed',
        errorMessage: message,
        finishedAt: new Date(),
      })
      const row = await prisma.downloadTask.findUnique({ where: { id: run.taskId } })
      if (row) return toTaskView(row)
    }
    throw err
  }
}

export async function downloadAllEnabled(
  userId: string,
  range: DateRangeResolved,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<DownloadTaskView[]> {
  const results: DownloadTaskView[] = []
  for (const type of DOWNLOAD_TYPES) {
    if (!(await isDownloadTypeAvailable(type))) continue
    try {
      const task = await downloadByType(type, userId, range, audit)
      results.push(task)
    } catch (err) {
      const task = await prisma.downloadTask.create({
        data: {
          type,
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : '下载失败',
          startedAt: new Date(),
          finishedAt: new Date(),
          createdBy: userId,
        },
      })
      results.push(toTaskView(task))
    }
  }
  if (!results.length) {
    throw new Error('没有已启用的下载配置，请先在系统设置设置并启用')
  }
  return results
}

export async function listRecentTasks(limit = 50): Promise<DownloadTaskView[]> {
  const rows = await prisma.downloadTask.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.map(toTaskView)
}

export async function getTaskById(id: string): Promise<DownloadTaskDetailView | null> {
  const row = await prisma.downloadTask.findUnique({ where: { id } })
  if (!row) return null
  const base = toTaskView(row)
  const pipeline = toPipelineView(row.pipelineMetaJson, row.mode)
  let orderDiagnostics = null
  let liveDiagnostics = null
  const pipelineMeta = parsePipelineMeta(row.pipelineMetaJson)
  if (row.type === 'order') {
    const debug = await loadOrderApiDebug(row.id)
    orderDiagnostics = orderDiagnosticsToView(debug, {
      xlsxDownloaded: pipelineMeta.xlsxDownloaded,
      failedPhase: pipelineMeta.failedPhase,
    })
  }
  if (row.type === 'live') {
    const debug = await loadTaskApiDebug(row.id)
    liveDiagnostics = liveDiagnosticsToView(debug, {
      signSuccess: pipelineMeta.signSuccess,
      apiSuccess: pipelineMeta.apiSuccess,
      failedPhase: pipelineMeta.failedPhase,
    })
  }
  return {
    ...base,
    step: row.step,
    pipeline,
    orderDiagnostics,
    liveDiagnostics,
  }
}
