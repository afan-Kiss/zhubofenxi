import fs from 'node:fs'
import path from 'node:path'
import { getDownloadDir, getMaxDownloadBytes } from '../config/env'
import type { DateRangeResolved } from '../utils/date-range'
import { getDecryptedCookie } from './credential.service'
import { writeOperationLog } from './audit.service'
import { prisma } from '../lib/prisma'
import { sanitizeUrlForLog } from '../utils/url-sanitize'
import type { DownloadProgressContext } from '../types/download-batch'
import { requestXhsJsonWithSyncAudit } from './sync-request-audit.service'
import { XHS_BROWSER_UA } from './xhs-http.service'
import {
  failedPhaseFromStep,
  initDownloadPipeline,
  patchDownloadPipeline,
} from './download-pipeline-meta.service'
import {
  emptyOrderApiDebug,
  isBusinessOkMsg,
  isWatchExportBusinessFailure,
  isWatchExportComplete,
  normalizeWatchState,
  parseStartExportEnvelope,
  parseWatchExportEnvelope,
  saveOrderApiDebug,
  summarizeOrderStartBody,
  extractWatchFileUrl,
} from './xhs-order-export-diagnostics.service'
import { initLiveTaskApiDebug } from './download-task-api-debug.service'

const START_EXPORT_URL =
  'https://ark.xiaohongshu.com/api/edith/fulfillment/tool/file/start_export'
const WATCH_EXPORT_URL =
  'https://ark.xiaohongshu.com/api/edith/fulfillment/tool/file/watch_export'
const ORDER_EXPORT_REFERER = 'https://ark.xiaohongshu.com/app-order/order/query'
const LIVE_TASK_SUBMIT_URL =
  'https://ark.xiaohongshu.com/api/edith/long_task/task/submit'
const LIVE_TASK_DETAIL_URL =
  'https://ark.xiaohongshu.com/api/edith/long_task/task/detail'

const POLL_INTERVAL_MS = 2000
const EXPORT_TIMEOUT_MS = 120_000

/** 订单表：3 秒轮询，最长 5 分钟 */
const ORDER_POLL_INTERVAL_MS = 3_000
const ORDER_EXPORT_TIMEOUT_MS = 5 * 60_000
const ORDER_STALL_PROGRESS_HINT_POLLS = 20
const ORDER_EXPORT_TIMEOUT_MSG =
  '订单表导出超时：小红书已创建导出任务但长时间未生成文件，请稍后重试或切换临时链接下载。'

export interface XhsExportResult {
  taskId: string
  savedFilePath: string
  fileName: string
  fileSize: number
  startTimeMs: number
  endTimeMs: number
  downloadTaskId: string
}

export interface XhsLiveExportResult {
  taskId: string
  savedFilePath: string
  fileName: string
  fileSize: number
  startDate: string
  endDate: string
  downloadTaskId: string
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 某月首尾日期（month 为 1-12） */
export function monthDateBounds(year: number, month: number): {
  startDate: string
  endDate: string
  dateParam: string
} {
  const startDate = `${year}-${pad2(month)}-01`
  const lastDay = new Date(year, month, 0)
  const endDate = `${year}-${pad2(month)}-${pad2(lastDay.getDate())}`
  return { startDate, endDate, dateParam: startDate }
}

function buildDataCondition(startTimeMs: number, endTimeMs: number): string {
  const condition = {
    multi_search_field: '',
    order_tag_list: [],
    order_type_list: [],
    promise_ship_time_type_list: [],
    after_sale_status_list: [],
    time_range_list: [
      {
        timeType: 'ordered',
        startTime: startTimeMs,
        endTime: endTimeMs,
      },
    ],
    seller_mark_priority_list: [],
    seller_mark_note_status_list: [],
    overdue_status: -2,
    status_list: [],
    sort_by: { sortField: 'ordered_at', desc: true },
    package_ids: [],
    need_declare_info: true,
    need_declare_times: true,
  }
  return JSON.stringify(condition)
}

function looksLikeHtml(buffer: Buffer, contentType: string): boolean {
  const ct = contentType.toLowerCase()
  if (ct.includes('text/html')) return true
  const head = buffer.subarray(0, 512).toString('utf8').trim().toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html')
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
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function xhsAuditBase(params: {
  userId: string
  username: string
  role: string
  requestId?: string
  ip?: string
  userAgent?: string
  downloadTaskId?: string
}) {
  return {
    userId: params.userId,
    username: params.username,
    role: params.role,
    requestId: params.requestId ?? null,
    ip: params.ip ?? null,
    userAgent: params.userAgent ?? null,
    module: 'xhs_export',
    downloadTaskId: params.downloadTaskId,
  }
}

async function downloadCosFileToLocal(
  fileUrl: string,
  fallbackName: string,
  excelErrorMessage: string,
): Promise<{ savedFilePath: string; fileName: string; fileSize: number }> {
  const maxBytes = getMaxDownloadBytes()
  const fileRes = await fetch(fileUrl, {
    headers: { 'User-Agent': XHS_BROWSER_UA },
    redirect: 'follow',
  })

  if (!fileRes.ok) {
    throw new Error(`文件下载失败 HTTP ${fileRes.status}`)
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer())
  const contentType = fileRes.headers.get('content-type') ?? ''

  if (buffer.length > maxBytes) {
    throw new Error(
      `文件过大（超过 ${Math.floor(maxBytes / 1024 / 1024)}MB 限制），已中断下载`,
    )
  }

  if (looksLikeHtml(buffer, contentType)) {
    throw new Error(excelErrorMessage)
  }

  if (!looksLikeExcel(buffer, contentType)) {
    throw new Error(excelErrorMessage)
  }

  const dir = getDownloadDir()
  const safeName = fallbackName.replace(/[<>:"/\\|?*]/g, '_')
  const savedFilePath = path.join(dir, safeName)
  fs.writeFileSync(savedFilePath, buffer)

  return { savedFilePath, fileName: safeName, fileSize: buffer.length }
}

export async function exportXhsOrderByRange(params: {
  range: DateRangeResolved
  userId: string
  username: string
  role: string
  requestId?: string
  ip?: string
  userAgent?: string
  progress?: DownloadProgressContext
}): Promise<XhsExportResult> {
  const { range, userId, username, role, requestId, ip, userAgent, progress } = params

  let cookie: string
  try {
    cookie = await getDecryptedCookie()
  } catch {
    throw new Error('尚未配置平台 Cookie，请先在系统设置保存')
  }

  const downloadTask = progress?.taskId
    ? await prisma.downloadTask.update({
        where: { id: progress.taskId },
        data: {
          type: 'order',
          mode: 'auto_export',
          status: 'exporting',
          startedAt: new Date(),
          batchId: progress.batchId ?? undefined,
        },
      })
    : await prisma.downloadTask.create({
        data: {
          type: 'order',
          mode: 'auto_export',
          status: 'downloading',
          startedAt: new Date(),
          createdBy: userId,
          requestId: requestId ?? null,
          batchId: progress?.batchId ?? null,
        },
      })

  const auditBase = {
    userId,
    username,
    role,
    ip,
    userAgent,
    requestId,
    downloadTaskId: downloadTask.id,
  }

  await initDownloadPipeline(downloadTask.id, 'auto_export')
  await saveOrderApiDebug(downloadTask.id, emptyOrderApiDebug())

  try {
    const dataCondition = buildDataCondition(range.startTimeMs, range.endTimeMs)
    const requestBodySummary = summarizeOrderStartBody(dataCondition)
    const startBody = {
      data_condition: dataCondition,
      source_data_bean: 'OrderQueryPackageFileBuilder',
    }

    await writeOperationLog({
      ...auditBase,
      action: 'export_order_start',
      module: 'xhs_export',
      description: `发起小红书订单导出 ${range.startDate} ~ ${range.endDate}`,
      meta: {
        startDate: range.startDate,
        endDate: range.endDate,
        downloadTaskId: downloadTask.id,
        requestBodySummary,
      },
    })

    await progress?.setStep('export_start')
    const httpAudit = xhsAuditBase({
      userId,
      username,
      role,
      requestId,
      ip,
      userAgent,
      downloadTaskId: downloadTask.id,
    })
    const startRes = await requestXhsJsonWithSyncAudit<Record<string, unknown>>({
      apiName: 'order_export_start',
      method: 'POST',
      urlKey: START_EXPORT_URL,
      trigger: 'manual',
      options: {
        method: 'POST',
        url: START_EXPORT_URL,
        body: startBody,
        cookie,
        referer: ORDER_EXPORT_REFERER,
        audit: httpAudit,
        needSign: true,
        parseEnvelope: false,
      },
    })

    const startDiag = parseStartExportEnvelope(startRes, requestBodySummary)
    await saveOrderApiDebug(downloadTask.id, { startExport: startDiag })

    await writeOperationLog({
      ...auditBase,
      action: 'export_order_start_response',
      module: 'xhs_export',
      description: `start_export 响应 code=${startDiag.code} hasTaskId=${startDiag.hasTaskId}`,
      meta: {
        downloadTaskId: downloadTask.id,
        code: startDiag.code,
        success: startDiag.success,
        msg: startDiag.msg,
        dataSuccess: startDiag.dataSuccess,
        dataTaskId: startDiag.dataTaskId,
        hasTaskId: startDiag.hasTaskId,
        taskIdSource: startDiag.taskIdSource,
        requestBodySummary: startDiag.requestBodySummary,
      },
    })

    if (startDiag.code != null && startDiag.code !== 0) {
      throw new Error(`订单表导出失败：${startDiag.msg ?? `code=${startDiag.code}`}`)
    }
    if (startDiag.success === false) {
      throw new Error(`订单表导出失败：${startDiag.msg ?? 'success=false'}`)
    }
    if (startDiag.msg && !isBusinessOkMsg(startDiag.msg)) {
      throw new Error(`订单表导出失败：${startDiag.msg}`)
    }

    const exportTaskId = startDiag.dataTaskId
    if (!exportTaskId) {
      await saveOrderApiDebug(downloadTask.id, { failedStep: 'start_export' })
      await prisma.downloadTask.update({
        where: { id: downloadTask.id },
        data: {
          errorMessage: '小红书导出任务创建失败，未返回 task_id（详见 apiDebugJson）',
        },
      })
      throw new Error('小红书导出任务创建失败，未返回 task_id')
    }

    await prisma.downloadTask.update({
      where: { id: downloadTask.id },
      data: { xhsTaskId: exportTaskId },
    })

    const deadline = Date.now() + ORDER_EXPORT_TIMEOUT_MS
    let fileUrl: string | null = null
    let pollIndex = 0
    let consecutiveZeroProgress = 0
    let stallHintLogged = false

    while (Date.now() < deadline) {
      await sleep(ORDER_POLL_INTERVAL_MS)
      pollIndex++
      await progress?.setStep('poll_record')

      const watchRes = await requestXhsJsonWithSyncAudit<Record<string, unknown>>({
        apiName: 'order_export_watch',
        method: 'POST',
        urlKey: WATCH_EXPORT_URL,
        trigger: 'manual',
        options: {
          method: 'POST',
          url: WATCH_EXPORT_URL,
          body: { task_id: exportTaskId },
          cookie,
          referer: ORDER_EXPORT_REFERER,
          audit: httpAudit,
          needSign: true,
          parseEnvelope: false,
        },
      })

      const fileUrlNow = extractWatchFileUrl(watchRes)
      if (fileUrlNow) {
        fileUrl = fileUrlNow
        break
      }

      const watchDiag = parseWatchExportEnvelope(watchRes, pollIndex)
      await saveOrderApiDebug(downloadTask.id, {
        lastWatch: watchDiag,
        watchPollCount: pollIndex,
        stallProgressHintLogged: stallHintLogged,
      })

      const bizFail = isWatchExportBusinessFailure(watchDiag)
      if (bizFail.failed) {
        await saveOrderApiDebug(downloadTask.id, { failedStep: 'watch_export' })
        throw new Error(`订单表导出失败：${bizFail.message}`)
      }

      const progressVal = watchDiag.taskProgress ?? 0
      if (progressVal === 0) {
        consecutiveZeroProgress++
      } else {
        consecutiveZeroProgress = 0
      }

      if (
        consecutiveZeroProgress >= ORDER_STALL_PROGRESS_HINT_POLLS &&
        !stallHintLogged
      ) {
        stallHintLogged = true
        await saveOrderApiDebug(downloadTask.id, { stallProgressHintLogged: true })
        await writeOperationLog({
          ...auditBase,
          action: 'export_order_watch',
          module: 'xhs_export',
          description: '订单导出任务已创建，但进度暂未变化',
          meta: {
            exportTaskId,
            downloadTaskId: downloadTask.id,
            consecutiveZeroProgress,
            pollIndex: watchDiag.pollIndex,
            code: watchDiag.code,
            success: watchDiag.success,
            msg: watchDiag.msg,
            taskState: watchDiag.taskState,
            taskProgress: watchDiag.taskProgress,
            fieldPaths: watchDiag.fieldPaths,
            parseNote: watchDiag.parseNote,
          },
        })
      }

      await writeOperationLog({
        ...auditBase,
        action: 'export_order_watch',
        module: 'xhs_export',
        description: `watch_export #${pollIndex} state=${watchDiag.taskState ?? '—'} progress=${progressVal} paths=${JSON.stringify(watchDiag.fieldPaths)}`,
        meta: {
          exportTaskId,
          downloadTaskId: downloadTask.id,
          code: watchDiag.code,
          success: watchDiag.success,
          msg: watchDiag.msg,
          taskState: watchDiag.taskState,
          taskProgress: watchDiag.taskProgress,
          taskMessage: watchDiag.taskMessage,
          hasFileUrl: watchDiag.hasFileUrl,
          fileUrlHost: watchDiag.fileUrlHost,
          fileUrlPath: watchDiag.fileUrlPath,
          fieldPaths: watchDiag.fieldPaths,
          parseNote: watchDiag.parseNote,
        },
      })

      if (isWatchExportComplete(watchDiag)) {
        const urlDone = extractWatchFileUrl(watchRes)
        if (urlDone) {
          fileUrl = urlDone
          break
        }
      }

      const st = normalizeWatchState(watchDiag.taskState)
      if (st === 'failed' || st === 'error') {
        throw new Error(
          `订单表导出失败：${watchDiag.taskMessage ?? watchDiag.msg ?? '任务失败'}`,
        )
      }
    }

    if (!fileUrl) {
      await saveOrderApiDebug(downloadTask.id, { failedStep: 'poll' })
      throw new Error(ORDER_EXPORT_TIMEOUT_MSG)
    }

    await patchDownloadPipeline(downloadTask.id, { fileUrlObtained: true })

    const stamp = `${range.startDate}_${range.endDate}`.replace(/[^\d-]/g, '')
    const fallbackName = `order-xhs-${stamp}-${Date.now()}.xlsx`
    await progress?.setStep('download_file')
    const { savedFilePath, fileName: safeName, fileSize } = await downloadCosFileToLocal(
      fileUrl,
      fallbackName,
      '下载结果不是 Excel，可能 Cookie 失效或下载链接错误',
    )
    await progress?.setStep('validate_file')
    await patchDownloadPipeline(downloadTask.id, { xlsxDownloaded: true })

    const updated = await prisma.downloadTask.update({
      where: { id: downloadTask.id },
      data: {
        status: 'success',
        fileName: safeName,
        filePath: savedFilePath,
        fileSize,
        finishedAt: new Date(),
        errorMessage: null,
        mode: 'auto_export',
      },
    })

    await progress?.setStep('success')

    await writeOperationLog({
      ...auditBase,
      action: 'export_order_success',
      module: 'xhs_export',
      description: `小红书订单导出成功 ${safeName}`,
      meta: {
        exportTaskId,
        fileName: safeName,
        fileSize,
        startDate: range.startDate,
        endDate: range.endDate,
        cosPath: sanitizeUrlForLog(fileUrl),
        downloadTaskId: downloadTask.id,
      },
    })

    await writeOperationLog({
      ...auditBase,
      action: 'download_file_success',
      module: 'download',
      description: `订单表下载成功 ${safeName}`,
      meta: { type: 'order', fileName: safeName, fileSize, mode: 'auto_export' },
    })

    return {
      taskId: exportTaskId,
      savedFilePath,
      fileName: safeName,
      fileSize,
      startTimeMs: range.startTimeMs,
      endTimeMs: range.endTimeMs,
      downloadTaskId: updated.id,
    }
  } catch (err) {
    await progress?.setStep('failed')
    const message = err instanceof Error ? err.message : '导出失败'
    const current = await prisma.downloadTask.findUnique({ where: { id: downloadTask.id } })
    await patchDownloadPipeline(downloadTask.id, {
      failedPhase: failedPhaseFromStep(current?.step),
    })
    await prisma.downloadTask.update({
      where: { id: downloadTask.id },
      data: {
        status: 'failed',
        errorMessage: message,
        finishedAt: new Date(),
      },
    })

    await writeOperationLog({
      ...auditBase,
      action: 'export_order_failed',
      module: 'xhs_export',
      description: `小红书订单导出失败：${message}`,
      meta: { startDate: range.startDate, endDate: range.endDate, error: message },
    })

    await writeOperationLog({
      ...auditBase,
      action: 'download_file_failed',
      module: 'download',
      description: `订单表下载失败：${message}`,
      meta: { type: 'order', error: message },
    })

    throw new Error(message)
  }
}

interface LiveTaskSubmitResponse {
  data?: { task_id?: string; taskId?: string }
  task_id?: string
}

interface LiveTaskDetailPayload {
  status?: number
  result?: {
    file_url?: string
    file_name_alias?: string
  }
}

interface LiveTaskDetailResponse {
  data?: LiveTaskDetailPayload
  status?: number
  result?: LiveTaskDetailPayload['result']
}

export async function exportXhsLiveSessionsByMonth(params: {
  year: number
  month: number
  userId: string
  username: string
  role: string
  sellerId: string
  requestId?: string
  ip?: string
  userAgent?: string
  progress?: DownloadProgressContext
}): Promise<XhsLiveExportResult> {
  const { year, month, userId, username, role, sellerId, requestId, ip, userAgent, progress } =
    params

  if (month < 1 || month > 12) {
    throw new Error('月份无效')
  }

  const bounds = monthDateBounds(year, month)

  let cookie: string
  try {
    cookie = await getDecryptedCookie()
  } catch {
    throw new Error('尚未配置平台 Cookie，请先在系统设置保存')
  }

  const downloadTask = progress?.taskId
    ? await prisma.downloadTask.update({
        where: { id: progress.taskId },
        data: {
          type: 'live',
          mode: 'auto_export',
          status: 'exporting',
          startedAt: new Date(),
          batchId: progress.batchId ?? undefined,
        },
      })
    : await prisma.downloadTask.create({
        data: {
          type: 'live',
          mode: 'auto_export',
          status: 'downloading',
          startedAt: new Date(),
          createdBy: userId,
          requestId: requestId ?? null,
          batchId: progress?.batchId ?? null,
        },
      })

  const auditBase = {
    userId,
    username,
    role,
    ip,
    userAgent,
    requestId,
    downloadTaskId: downloadTask.id,
  }

  await initDownloadPipeline(downloadTask.id, 'auto_export')
  await initLiveTaskApiDebug(downloadTask.id)

  try {
    await progress?.setStep('export_start')
    const submitBody = {
      task_name: 'batch_download_data_ark_hive',
      module_name: 'ark_data_center',
      subsystem_alias: 'ark',
      input: {
        extra: {
          blockKey: 'sellerLiveDetailData',
          sellerId,
          dateSelectType: 'month',
          dateType: 2000,
          date: bounds.dateParam,
          anchorType: 0,
          anchorId: 'all',
        },
      },
    }

    await writeOperationLog({
      ...auditBase,
      action: 'live_export_start',
      module: 'xhs_export',
      description: `发起直播场次导出 ${bounds.startDate} ~ ${bounds.endDate}`,
      meta: {
        year,
        month,
        sellerId,
        downloadTaskId: downloadTask.id,
        mode: 'auto_export',
      },
    })

    const httpAudit = xhsAuditBase({
      userId,
      username,
      role,
      requestId,
      ip,
      userAgent,
      downloadTaskId: downloadTask.id,
    })
    const submitRes = await requestXhsJsonWithSyncAudit<LiveTaskSubmitResponse>({
      apiName: 'live_task_export_submit',
      method: 'POST',
      urlKey: LIVE_TASK_SUBMIT_URL,
      trigger: 'manual',
      options: {
        method: 'POST',
        url: LIVE_TASK_SUBMIT_URL,
        body: submitBody,
        cookie,
        audit: httpAudit,
        needSign: true,
        parseEnvelope: false,
      },
    })

    const exportTaskId =
      submitRes.data?.task_id ?? submitRes.data?.taskId ?? submitRes.task_id

    if (!exportTaskId) {
      throw new Error('直播场次导出任务创建失败，未返回 task_id')
    }

    await prisma.downloadTask.update({
      where: { id: downloadTask.id },
      data: { xhsTaskId: exportTaskId },
    })

    const deadline = Date.now() + EXPORT_TIMEOUT_MS
    let fileUrl: string | null = null
    let fileNameAlias: string | null = null

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS)
      await progress?.setStep('poll_record')

      const detailUrl = `${LIVE_TASK_DETAIL_URL}?task_id=${encodeURIComponent(exportTaskId)}`
      const detailRes = await requestXhsJsonWithSyncAudit<LiveTaskDetailResponse>({
        apiName: 'live_task_export_detail',
        method: 'GET',
        urlKey: LIVE_TASK_DETAIL_URL,
        trigger: 'manual',
        options: {
          method: 'GET',
          url: detailUrl,
          cookie,
          audit: httpAudit,
          needSign: true,
          parseEnvelope: false,
        },
      })

      const payload = detailRes.data ?? detailRes
      const status = Number(payload.status ?? detailRes.status ?? 0)
      const result = payload.result ?? detailRes.result
      const url = result?.file_url
      fileNameAlias = result?.file_name_alias ?? fileNameAlias

      await writeOperationLog({
        ...auditBase,
        action: 'live_export_watch',
        module: 'xhs_export',
        description: `轮询直播场次导出 status=${status}`,
        meta: {
          exportTaskId,
          status,
          downloadTaskId: downloadTask.id,
          mode: 'auto_export',
        },
      })

      if (status === 3) {
        if (url) {
          fileUrl = url
          break
        }
        throw new Error('直播场次导出完成但没有下载地址')
      }
    }

    if (!fileUrl) {
      throw new Error('直播场次导出超时，请稍后重试')
    }

    await patchDownloadPipeline(downloadTask.id, { fileUrlObtained: true })

    const fallbackName =
      fileNameAlias?.replace(/[<>:"/\\|?*]/g, '_') ||
      `live-xhs-${bounds.startDate}_${bounds.endDate}-${Date.now()}.xlsx`

    await progress?.setStep('download_file')
    const { savedFilePath, fileName, fileSize } = await downloadCosFileToLocal(
      fileUrl,
      fallbackName,
      '直播场次下载结果不是 Excel，可能 Cookie 失效或接口参数错误',
    )
    await progress?.setStep('validate_file')
    await patchDownloadPipeline(downloadTask.id, { xlsxDownloaded: true })

    const updated = await prisma.downloadTask.update({
      where: { id: downloadTask.id },
      data: {
        status: 'success',
        fileName,
        filePath: savedFilePath,
        fileSize,
        finishedAt: new Date(),
        errorMessage: null,
        mode: 'auto_export',
      },
    })

    await progress?.setStep('success')

    await writeOperationLog({
      ...auditBase,
      action: 'live_export_success',
      module: 'xhs_export',
      description: `直播场次导出成功 ${fileName}`,
      meta: {
        exportTaskId,
        fileName,
        fileSize,
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        cosPath: sanitizeUrlForLog(fileUrl),
        downloadTaskId: downloadTask.id,
        mode: 'auto_export',
      },
    })

    await writeOperationLog({
      ...auditBase,
      action: 'live_download_success',
      module: 'download',
      description: `直播场次表下载成功 ${fileName}`,
      meta: { type: 'live', fileName, fileSize, mode: 'auto_export' },
    })

    return {
      taskId: exportTaskId,
      savedFilePath,
      fileName,
      fileSize,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      downloadTaskId: updated.id,
    }
  } catch (err) {
    await progress?.setStep('failed')
    const message = err instanceof Error ? err.message : '导出失败'
    const current = await prisma.downloadTask.findUnique({ where: { id: downloadTask.id } })
    await patchDownloadPipeline(downloadTask.id, {
      failedPhase: failedPhaseFromStep(current?.step),
    })
    await prisma.downloadTask.update({
      where: { id: downloadTask.id },
      data: {
        status: 'failed',
        errorMessage: message,
        finishedAt: new Date(),
        mode: 'auto_export',
      },
    })

    await writeOperationLog({
      ...auditBase,
      action: 'live_export_failed',
      module: 'xhs_export',
      description: `直播场次导出失败：${message}`,
      meta: { year, month, error: message, mode: 'auto_export' },
    })

    await writeOperationLog({
      ...auditBase,
      action: 'live_download_failed',
      module: 'download',
      description: `直播场次表下载失败：${message}`,
      meta: { type: 'live', error: message, mode: 'auto_export' },
    })

    throw new Error(message)
  }
}
