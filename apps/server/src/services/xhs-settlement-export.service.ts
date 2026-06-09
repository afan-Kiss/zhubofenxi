import fs from 'node:fs'
import path from 'node:path'
import { getDownloadDir, getMaxDownloadBytes } from '../config/env'
import type { DownloadType } from '../types/download'
import type { AuditAction } from '../types/audit'
import { getDecryptedCookie } from './credential.service'
import { writeOperationLog } from './audit.service'
import { prisma } from '../lib/prisma'
import { sanitizeUrlForLog } from '../utils/url-sanitize'
import type { DownloadProgressContext } from '../types/download-batch'
import { requestXhsJson, XHS_BROWSER_UA } from './xhs-http.service'
import {
  failedPhaseFromStep,
  initDownloadPipeline,
  patchDownloadPipeline,
} from './download-pipeline-meta.service'

const EXPORT_BILL_URL =
  'https://ark.xiaohongshu.com/api/edith/settlebill/export_bill'
const QUERY_EXPORT_LIST_URL =
  'https://ark.xiaohongshu.com/api/edith/settlebill/query_export_record_list'
const GET_BILL_DOWNLOAD_URL =
  'https://ark.xiaohongshu.com/api/edith/settlebill/get_bill_download_url'

const INITIAL_WAIT_MS = 60_000
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 120_000

export type SettlementExportKind = 'settledSettlement' | 'pendingSettlement'

export interface XhsSettlementExportResult {
  exportTaskId: string
  recordTaskId: string
  savedFilePath: string
  fileName: string
  fileSize: number
  startTime: string
  endTime: string
  status: string
  downloadTaskId: string
}

export type XhsSettledExportResult = XhsSettlementExportResult

interface ExportBillResponse {
  code?: number
  success?: boolean
  msg?: string
  data?: {
    taskId?: string
    settleBillBaseResponse?: { success?: boolean }
  }
}

interface ExportRecordItem {
  title?: string
  status?: string
  statusDesc?: string
  taskId?: string
  infoList?: Array<{ key?: string; value?: string }>
}

interface QueryExportListResponse {
  code?: number
  success?: boolean
  data?: {
    exportRecordList?: ExportRecordItem[]
  }
  exportRecordList?: ExportRecordItem[]
}

interface GetDownloadUrlResponse {
  code?: number
  success?: boolean
  data?: {
    downloadUrl?: string
  }
}

interface SettlementKindConfig {
  downloadType: SettlementExportKind
  billType: 'SETTLE_BILL' | 'UNSETTLE_BILL'
  settleStatus: 'SUCCESS' | 'INIT'
  timeType: 'SETTLE_TIME' | 'ORDER_CREATE_TIME'
  recordTitleKeyword: string
  infoTimeKey: string
  signatureHint: string
  timeoutMessage: string
  noDownloadUrlMessage: string
  exportFailMessage: string
  fileNamePrefix: string
  label: string
  queryListBody: Record<string, unknown>
  audit: {
    exportStart: AuditAction
    exportRecordPoll: AuditAction
    exportSuccess: AuditAction
    exportFailed: AuditAction
    downloadUrlSuccess: AuditAction
    downloadSuccess: AuditAction
    downloadFailed: AuditAction
  }
  buildExportBody: (startTime: string, endTime: string) => Record<string, unknown>
  buildTimeRange: (
    startDate: string,
    endDate: string,
    now?: Date,
  ) => { startTime: string; endTime: string; timeRangeLabel: string }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function todayDateString(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/** 已结算：结算时间，endTime 按 HAR 为 endDate 00:00:00 */
export function buildSettleTimeStrings(startDate: string, endDate: string): {
  startTime: string
  endTime: string
  settleTimeLabel: string
} {
  const startTime = `${startDate} 00:00:00`
  const endTime = `${endDate} 00:00:00`
  return {
    startTime,
    endTime,
    settleTimeLabel: `${startTime} - ${endTime}`,
  }
}

/** 待结算：下单时间；endDate 为今天则用当前时刻，否则 23:59:59 */
export function buildPendingTimeStrings(
  startDate: string,
  endDate: string,
  now = new Date(),
): { startTime: string; endTime: string; timeRangeLabel: string } {
  const startTime = `${startDate} 00:00:00`
  const endTime =
    endDate === todayDateString(now) ? formatDateTime(now) : `${endDate} 23:59:59`
  return { startTime, endTime, timeRangeLabel: `${startTime} - ${endTime}` }
}

const SETTLEMENT_KIND_CONFIG: Record<SettlementExportKind, SettlementKindConfig> = {
  settledSettlement: {
    downloadType: 'settledSettlement',
    billType: 'SETTLE_BILL',
    settleStatus: 'SUCCESS',
    timeType: 'SETTLE_TIME',
    recordTitleKeyword: '导出订单',
    infoTimeKey: '结算时间',
    signatureHint: '小红书结算导出接口可能需要前端签名参数，请重新抓包或改用手动下载模式',
    timeoutMessage: '已结算订单明细导出超时，请稍后重试或到小红书后台历史报表查看',
    noDownloadUrlMessage: '已结算订单明细导出完成但没有下载地址',
    exportFailMessage: '已结算订单明细导出任务创建失败，未返回 taskId',
    fileNamePrefix: '已结算订单明细',
    label: '已结算订单明细',
    queryListBody: { pageNum: 1, pageSize: 10 },
    audit: {
      exportStart: 'settled_export_start',
      exportRecordPoll: 'settled_export_record_poll',
      exportSuccess: 'settled_export_success',
      exportFailed: 'settled_export_failed',
      downloadUrlSuccess: 'settled_download_url_success',
      downloadSuccess: 'settled_download_success',
      downloadFailed: 'settled_download_failed',
    },
    buildTimeRange: (startDate, endDate) => {
      const t = buildSettleTimeStrings(startDate, endDate)
      return { startTime: t.startTime, endTime: t.endTime, timeRangeLabel: t.settleTimeLabel }
    },
    buildExportBody: (startTime, endTime) => ({
      billType: 'SETTLE_BILL',
      periodType: 'DETAIL',
      timeType: 'SETTLE_TIME',
      startTime,
      endTime,
      settleStatus: 'SUCCESS',
    }),
  },
  pendingSettlement: {
    downloadType: 'pendingSettlement',
    billType: 'UNSETTLE_BILL',
    settleStatus: 'INIT',
    timeType: 'ORDER_CREATE_TIME',
    recordTitleKeyword: '待结算订单导出',
    infoTimeKey: '下单时间',
    signatureHint:
      '小红书待结算导出接口可能需要前端签名参数，请重新抓包或改用临时链接下载模式',
    timeoutMessage: '待结算订单明细导出超时，请稍后重试或到小红书后台历史报表查看',
    noDownloadUrlMessage: '待结算订单明细导出完成但没有下载地址',
    exportFailMessage: '待结算订单明细导出任务创建失败，未返回 taskId',
    fileNamePrefix: '待结算订单明细',
    label: '待结算订单明细',
    queryListBody: {
      pageNum: 1,
      pageSize: 10,
      billType: 'UNSETTLE_BILL',
      periodType: 'DETAIL',
    },
    audit: {
      exportStart: 'pending_export_start',
      exportRecordPoll: 'pending_export_record_poll',
      exportSuccess: 'pending_export_success',
      exportFailed: 'pending_export_failed',
      downloadUrlSuccess: 'pending_download_url_success',
      downloadSuccess: 'pending_download_success',
      downloadFailed: 'pending_download_failed',
    },
    buildTimeRange: (startDate, endDate, now) => buildPendingTimeStrings(startDate, endDate, now),
    buildExportBody: (startTime, endTime) => ({
      billType: 'UNSETTLE_BILL',
      periodType: 'DETAIL',
      sortBy: 'ORDER_CREATE_TIME',
      sortOrder: 'DESC',
      settleStatus: 'INIT',
      timeType: 'ORDER_CREATE_TIME',
      startTime,
      endTime,
    }),
  },
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function settlementHttpAudit(params: {
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

function parseTitleTimestamp(title: string): number {
  const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(title)
  if (!match?.[1]) return 0
  return new Date(match[1].replace(' ', 'T')).getTime()
}

function pickMatchingRecord(
  records: ExportRecordItem[],
  config: SettlementKindConfig,
  timeRangeLabel: string,
  exportStartedAt: number,
): ExportRecordItem | null {
  const matched = records.filter((item) => {
    if (item.status !== 'SUCCESS') return false
    if (!item.title?.includes(config.recordTitleKeyword)) return false
    const timeInfo = item.infoList?.find((i) => i.key === config.infoTimeKey)
    return timeInfo?.value === timeRangeLabel
  })

  if (!matched.length) return null

  matched.sort((a, b) => parseTitleTimestamp(b.title ?? '') - parseTitleTimestamp(a.title ?? ''))

  const afterExport = matched.filter(
    (item) => parseTitleTimestamp(item.title ?? '') >= exportStartedAt - 60_000,
  )
  return (afterExport[0] ?? matched[0]) ?? null
}

async function downloadBillFileToLocal(
  downloadUrl: string,
  fallbackName: string,
): Promise<{ savedFilePath: string; fileName: string; fileSize: number }> {
  const maxBytes = getMaxDownloadBytes()
  const fileRes = await fetch(downloadUrl, {
    headers: { 'User-Agent': XHS_BROWSER_UA },
    redirect: 'follow',
  })

  if (!fileRes.ok) {
    throw new Error(`下载失败，HTTP ${fileRes.status}`)
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer())
  if (buffer.length > maxBytes) {
    throw new Error(`文件过大（超过 ${Math.floor(maxBytes / 1024 / 1024)}MB 限制）`)
  }

  const contentType = fileRes.headers.get('content-type') ?? ''
  if (looksLikeHtml(buffer, contentType)) {
    throw new Error('下载结果不是 Excel，可能 Cookie 失效或下载链接错误')
  }
  if (!looksLikeExcel(buffer, contentType)) {
    throw new Error('下载结果不是 Excel，可能 Cookie 失效或下载链接错误')
  }

  let fileName = fallbackName.replace(/[<>:"/\\|?*]/g, '_')
  try {
    const urlPath = new URL(downloadUrl).pathname
    const base = path.basename(urlPath)
    if (base && /\.xlsx?$/i.test(base)) {
      fileName = base.split('?')[0]!.replace(/[<>:"/\\|?*]/g, '_')
    }
  } catch {
    /* use fallback */
  }

  const dir = getDownloadDir()
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, buffer)

  return { savedFilePath: filePath, fileName, fileSize: buffer.length }
}

export async function exportSettlementBillByRange(params: {
  type: SettlementExportKind
  startDate: string
  endDate: string
  userId: string
  username: string
  role: string
  requestId?: string
  ip?: string
  userAgent?: string
  progress?: DownloadProgressContext
}): Promise<XhsSettlementExportResult> {
  const { type, startDate, endDate, userId, username, role, requestId, ip, userAgent, progress } =
    params
  const config = SETTLEMENT_KIND_CONFIG[type]
  const { startTime, endTime, timeRangeLabel } = config.buildTimeRange(startDate, endDate)

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
          type: config.downloadType,
          mode: 'auto_export',
          status: 'exporting',
          startedAt: new Date(),
          batchId: progress.batchId ?? undefined,
        },
      })
    : await prisma.downloadTask.create({
        data: {
          type: config.downloadType,
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

  try {
    await writeOperationLog({
      ...auditBase,
      action: config.audit.exportStart,
      module: 'xhs_export',
      description: `发起${config.label}导出 ${startDate} ~ ${endDate}`,
      meta: {
        startDate,
        endDate,
        startTime,
        endTime,
        downloadTaskId: downloadTask.id,
        mode: 'auto_export',
      },
    })

    const exportStartedAt = Date.now()
    await progress?.setStep('export_start')
    const httpAudit = settlementHttpAudit({
      userId,
      username,
      role,
      requestId,
      ip,
      userAgent,
      downloadTaskId: downloadTask.id,
    })
    const exportRes = await requestXhsJson<ExportBillResponse>({
      method: 'POST',
      url: EXPORT_BILL_URL,
      body: config.buildExportBody(startTime, endTime),
      cookie,
      audit: httpAudit,
    })

    const exportTaskId = exportRes.data?.taskId
    if (!exportTaskId) {
      throw new Error(config.exportFailMessage)
    }

    await prisma.downloadTask.update({
      where: { id: downloadTask.id },
      data: { xhsTaskId: exportTaskId },
    })

    await progress?.setStep('wait_history')
    await sleep(INITIAL_WAIT_MS)

    const pollDeadline = Date.now() + POLL_TIMEOUT_MS
    let matchedRecord: ExportRecordItem | null = null

    while (Date.now() < pollDeadline) {
      const listRes = await requestXhsJson<QueryExportListResponse>({
        method: 'POST',
        url: QUERY_EXPORT_LIST_URL,
        body: config.queryListBody,
        cookie,
        audit: httpAudit,
      })

      const records = listRes.data?.exportRecordList ?? listRes.exportRecordList ?? []
      matchedRecord = pickMatchingRecord(records, config, timeRangeLabel, exportStartedAt)
      await progress?.setStep('poll_record')

      await writeOperationLog({
        ...auditBase,
        action: config.audit.exportRecordPoll,
        module: 'xhs_export',
        description: `轮询${config.label}导出记录 matched=${matchedRecord ? 'yes' : 'no'}`,
        meta: {
          exportTaskId,
          recordCount: records.length,
          timeRangeLabel,
          downloadTaskId: downloadTask.id,
          mode: 'auto_export',
        },
      })

      if (matchedRecord?.taskId) break

      await sleep(POLL_INTERVAL_MS)
    }

    if (!matchedRecord?.taskId) {
      throw new Error(config.timeoutMessage)
    }

    const recordTaskId = String(matchedRecord.taskId)

    await progress?.setStep('get_download_url')
    const urlRes = await requestXhsJson<GetDownloadUrlResponse>({
      method: 'POST',
      url: GET_BILL_DOWNLOAD_URL,
      body: { taskId: recordTaskId, billType: 'EXPORT_BILL' },
      cookie,
      audit: httpAudit,
    })

    const downloadUrl = urlRes.data?.downloadUrl
    if (!downloadUrl) {
      throw new Error(config.noDownloadUrlMessage)
    }

    await patchDownloadPipeline(downloadTask.id, { fileUrlObtained: true })

    await writeOperationLog({
      ...auditBase,
      action: config.audit.downloadUrlSuccess,
      module: 'xhs_export',
      description: `获取${config.label}下载地址 taskId=${recordTaskId}`,
      meta: {
        exportTaskId,
        recordTaskId,
        cosPath: sanitizeUrlForLog(downloadUrl),
        downloadTaskId: downloadTask.id,
        mode: 'auto_export',
      },
    })

    const fallbackName = `${config.fileNamePrefix}_${startDate}至${endDate}.xlsx`
    await progress?.setStep('download_file')
    const { savedFilePath, fileName, fileSize } = await downloadBillFileToLocal(
      downloadUrl,
      fallbackName,
    )
    await progress?.setStep('validate_file')
    await patchDownloadPipeline(downloadTask.id, { xlsxDownloaded: true })

    const updated = await prisma.downloadTask.update({
      where: { id: downloadTask.id },
      data: {
        status: 'success',
        xhsTaskId: recordTaskId,
        fileName,
        filePath: savedFilePath,
        fileSize,
        finishedAt: new Date(),
        errorMessage: null,
        mode: 'auto_export',
      },
    })

    await writeOperationLog({
      ...auditBase,
      action: config.audit.exportSuccess,
      module: 'xhs_export',
      description: `${config.label}导出成功 ${fileName}`,
      meta: {
        startDate,
        endDate,
        exportTaskId,
        recordTaskId,
        fileName,
        fileSize,
        downloadTaskId: downloadTask.id,
        mode: 'auto_export',
      },
    })

    await writeOperationLog({
      ...auditBase,
      action: config.audit.downloadSuccess,
      module: 'download',
      description: `${config.label}下载成功 ${fileName}`,
      meta: {
        type: config.downloadType as DownloadType,
        fileName,
        fileSize,
        mode: 'auto_export',
      },
    })

    await progress?.setStep('success')

    return {
      exportTaskId,
      recordTaskId,
      savedFilePath,
      fileName,
      fileSize,
      startTime,
      endTime,
      status: updated.status,
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
      action: config.audit.exportFailed,
      module: 'xhs_export',
      description: `${config.label}导出失败：${message}`,
      meta: { startDate, endDate, errorMessage: message, mode: 'auto_export' },
    })

    await writeOperationLog({
      ...auditBase,
      action: config.audit.downloadFailed,
      module: 'download',
      description: `${config.label}下载失败：${message}`,
      meta: {
        type: config.downloadType as DownloadType,
        errorMessage: message,
        mode: 'auto_export',
      },
    })

    throw new Error(message)
  }
}

export async function exportXhsSettledBillByRange(params: {
  startDate: string
  endDate: string
  userId: string
  username: string
  role: string
  requestId?: string
  ip?: string
  userAgent?: string
  progress?: DownloadProgressContext
}): Promise<XhsSettlementExportResult> {
  return exportSettlementBillByRange({ ...params, type: 'settledSettlement' })
}

export async function exportXhsPendingBillByRange(params: {
  startDate: string
  endDate: string
  userId: string
  username: string
  role: string
  requestId?: string
  ip?: string
  userAgent?: string
  progress?: DownloadProgressContext
}): Promise<XhsSettlementExportResult> {
  return exportSettlementBillByRange({ ...params, type: 'pendingSettlement' })
}
