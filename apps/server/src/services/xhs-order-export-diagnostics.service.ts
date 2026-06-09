import { prisma } from '../lib/prisma'
import { sanitizeUrlForLog } from '../utils/url-sanitize'

/** 订单导出 API 脱敏诊断（不含 Cookie / 签名头） */
export interface OrderStartExportDiag {
  at: string
  code: number | null
  success: boolean | null
  msg: string | null
  dataSuccess: boolean | null
  dataTaskId: string | null
  hasTaskId: boolean
  taskIdSource: string | null
  requestBodySummary: {
    source_data_bean: string
    data_condition_timeType: string | null
    data_condition_startTime: number | null
    data_condition_endTime: number | null
  }
}

export interface OrderWatchExportDiag {
  at: string
  pollIndex: number
  code: number | null
  success: boolean | null
  msg: string | null
  taskState: string | null
  taskProgress: number | null
  taskMessage: string | null
  hasFileUrl: boolean
  fileUrlHost: string | null
  fileUrlPath: string | null
  fieldPaths: {
    state: string | null
    progress: string | null
    message: string | null
    fileUrl: string | null
  }
  parseNote: string | null
}

export interface OrderExportApiDebug {
  startExport?: OrderStartExportDiag
  lastWatch?: OrderWatchExportDiag
  watchPollCount: number
  stallProgressHintLogged: boolean
  failedStep: string | null
}

export function emptyOrderApiDebug(): OrderExportApiDebug {
  return { watchPollCount: 0, stallProgressHintLogged: false, failedStep: null }
}

function readPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function firstString(obj: unknown, paths: string[]): { value: string | null; path: string | null } {
  for (const path of paths) {
    const v = readPath(obj, path)
    if (v != null && v !== '') return { value: String(v), path }
  }
  return { value: null, path: null }
}

function firstNumber(obj: unknown, paths: string[]): { value: number | null; path: string | null } {
  for (const path of paths) {
    const v = readPath(obj, path)
    if (v != null && v !== '' && !Number.isNaN(Number(v))) {
      return { value: Number(v), path }
    }
  }
  return { value: null, path: null }
}

export function summarizeOrderStartBody(dataConditionJson: string): OrderStartExportDiag['requestBodySummary'] {
  const base = {
    source_data_bean: 'OrderQueryPackageFileBuilder',
    data_condition_timeType: null as string | null,
    data_condition_startTime: null as number | null,
    data_condition_endTime: null as number | null,
  }
  try {
    const cond = JSON.parse(dataConditionJson) as {
      time_range_list?: Array<{ timeType?: string; startTime?: number; endTime?: number }>
    }
    const tr = cond.time_range_list?.[0]
    if (tr) {
      base.data_condition_timeType = tr.timeType ?? null
      base.data_condition_startTime = tr.startTime ?? null
      base.data_condition_endTime = tr.endTime ?? null
    }
  } catch {
    /* ignore */
  }
  return base
}

export function parseStartExportEnvelope(
  raw: unknown,
  requestBodySummary: OrderStartExportDiag['requestBodySummary'],
): OrderStartExportDiag {
  const env = raw as Record<string, unknown>
  const code = typeof env.code === 'number' ? env.code : env.code != null ? Number(env.code) : null
  const success =
    typeof env.success === 'boolean' ? env.success : env.success != null ? Boolean(env.success) : null
  const msg = env.msg != null ? String(env.msg) : null

  const dataSuccessRaw = readPath(env, 'data.success')
  const dataSuccess =
    typeof dataSuccessRaw === 'boolean'
      ? dataSuccessRaw
      : dataSuccessRaw != null
        ? Boolean(dataSuccessRaw)
        : null

  const taskIdPick = firstString(env, [
    'data.task_id',
    'data.taskId',
    'data.task.task_id',
    'data.task.id',
    'task_id',
    'taskId',
  ])

  return {
    at: new Date().toISOString(),
    code: Number.isFinite(code) ? code : null,
    success,
    msg,
    dataSuccess,
    dataTaskId: taskIdPick.value,
    hasTaskId: Boolean(taskIdPick.value),
    taskIdSource: taskIdPick.path,
    requestBodySummary,
  }
}

export function parseWatchExportEnvelope(raw: unknown, pollIndex: number): OrderWatchExportDiag {
  const env = raw as Record<string, unknown>
  const code = typeof env.code === 'number' ? env.code : env.code != null ? Number(env.code) : null
  const success =
    typeof env.success === 'boolean' ? env.success : env.success != null ? Boolean(env.success) : null
  const msg = env.msg != null ? String(env.msg) : null

  const statePick = firstString(env, [
    'data.task.state',
    'data.task.status',
    'data.state',
    'data.status',
    'task.state',
    'state',
  ])
  const progressPick = firstNumber(env, [
    'data.task.progress',
    'data.progress',
    'task.progress',
    'progress',
  ])
  const messagePick = firstString(env, [
    'data.task.message',
    'data.message',
    'task.message',
    'message',
  ])
  const urlPick = firstString(env, [
    'data.task.file_url',
    'data.task.fileUrl',
    'data.file_url',
    'data.fileUrl',
    'file_url',
    'fileUrl',
  ])

  let fileUrlHost: string | null = null
  let fileUrlPath: string | null = null
  if (urlPick.value) {
    try {
      const u = new URL(urlPick.value)
      fileUrlHost = u.host
      fileUrlPath = u.pathname
    } catch {
      fileUrlPath = sanitizeUrlForLog(urlPick.value)
    }
  }

  const usedLegacyOnly =
    !statePick.path?.includes('task') &&
    (readPath(env, 'data.task') != null || readPath(env, 'task') != null)

  return {
    at: new Date().toISOString(),
    pollIndex,
    code: Number.isFinite(code) ? code : null,
    success,
    msg,
    taskState: statePick.value,
    taskProgress: progressPick.value,
    taskMessage: messagePick.value,
    hasFileUrl: Boolean(urlPick.value),
    fileUrlHost,
    fileUrlPath,
    fieldPaths: {
      state: statePick.path,
      progress: progressPick.path,
      message: messagePick.path,
      fileUrl: urlPick.path,
    },
    parseNote: usedLegacyOnly
      ? '响应含 task 对象但 state/progress 未从 data.task 解析到，可能字段路径不匹配'
      : statePick.path == null && progressPick.value === 0
        ? '未匹配到 state/progress 字段路径，日志中的 progress=0 可能为解析默认空值'
        : null,
  }
}

export function isBusinessOkMsg(msg: string | null | undefined): boolean {
  if (!msg) return true
  const m = msg.trim().toLowerCase()
  return m === 'ok' || m === 'success' || m === '成功' || m === ''
}

export function normalizeWatchState(state: string | null): string {
  return (state ?? '').trim().toLowerCase()
}

export function isWatchExportBusinessFailure(
  diag: OrderWatchExportDiag,
): { failed: boolean; message: string } {
  if (diag.code != null && diag.code !== 0) {
    return { failed: true, message: diag.msg ?? `接口 code=${diag.code}` }
  }
  if (diag.success === false) {
    return { failed: true, message: diag.msg ?? '接口返回 success=false' }
  }
  if (diag.msg && !isBusinessOkMsg(diag.msg)) {
    return { failed: true, message: diag.msg }
  }
  if (diag.taskMessage && !isBusinessOkMsg(diag.taskMessage)) {
    return { failed: true, message: diag.taskMessage }
  }
  const st = normalizeWatchState(diag.taskState)
  if (st === 'failed' || st === 'error') {
    return {
      failed: true,
      message: diag.taskMessage ?? diag.msg ?? '导出任务失败',
    }
  }
  return { failed: false, message: '' }
}

export function extractWatchFileUrl(raw: unknown): string | null {
  const pick = firstString(raw, [
    'data.task.file_url',
    'data.task.fileUrl',
    'data.file_url',
    'data.fileUrl',
    'file_url',
    'fileUrl',
  ])
  return pick.value
}

export function isWatchExportComplete(diag: OrderWatchExportDiag): boolean {
  if (diag.hasFileUrl) return true
  const st = normalizeWatchState(diag.taskState)
  const progress = diag.taskProgress ?? 0
  if (st === 'finish' || st === 'finished' || st === 'success' || st === 'done') return true
  if (progress >= 100) return true
  return false
}

export async function loadOrderApiDebug(taskId: string): Promise<OrderExportApiDebug> {
  const row = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { apiDebugJson: true },
  })
  if (!row?.apiDebugJson) return emptyOrderApiDebug()
  try {
    return { ...emptyOrderApiDebug(), ...(JSON.parse(row.apiDebugJson) as OrderExportApiDebug) }
  } catch {
    return emptyOrderApiDebug()
  }
}

export async function saveOrderApiDebug(
  taskId: string,
  patch: Partial<OrderExportApiDebug>,
): Promise<OrderExportApiDebug> {
  const current = await loadOrderApiDebug(taskId)
  const next = { ...current, ...patch }
  await prisma.downloadTask.update({
    where: { id: taskId },
    data: { apiDebugJson: JSON.stringify(next) },
  })
  return next
}

export function orderDiagnosticsToView(debug: OrderExportApiDebug, pipeline?: {
  xlsxDownloaded: boolean | null
  failedPhase: string | null
}) {
  return {
    startExportOk: debug.startExport?.hasTaskId ?? null,
    taskId: debug.startExport?.dataTaskId ?? null,
    lastWatchState: debug.lastWatch?.taskState ?? null,
    lastWatchProgress: debug.lastWatch?.taskProgress ?? null,
    lastWatchMessage: debug.lastWatch?.taskMessage ?? null,
    hasFileUrl: debug.lastWatch?.hasFileUrl ?? false,
    xlsxDownloaded: pipeline?.xlsxDownloaded ?? false,
    failedStep: debug.failedStep ?? pipeline?.failedPhase ?? null,
    watchPollCount: debug.watchPollCount,
    startExport: debug.startExport ?? null,
    lastWatch: debug.lastWatch ?? null,
    stallProgressHintLogged: debug.stallProgressHintLogged,
  }
}
