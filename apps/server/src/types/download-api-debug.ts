/** 下载任务失败阶段（流水线 / API 诊断共用） */
export type DownloadFailedPhase =
  | 'sign'
  | 'api'
  | 'poll'
  | 'file_url'
  | 'download'
  | 'validate'
  | 'config'
  | 'timeout'
  | 'unknown'

const FAILED_PHASE_SET = new Set<string>([
  'sign',
  'api',
  'poll',
  'file_url',
  'download',
  'validate',
  'config',
  'timeout',
  'unknown',
])

/** 将历史或步骤名映射到标准 failedPhase */
const LEGACY_FAILED_PHASE: Record<string, DownloadFailedPhase> = {
  parse: 'validate',
  request: 'api',
  response: 'api',
  start_export: 'api',
  watch_export: 'poll',
}

export function isDownloadFailedPhase(value: string): value is DownloadFailedPhase {
  return FAILED_PHASE_SET.has(value)
}

export function normalizeDownloadFailedPhase(
  value: string | null | undefined,
): DownloadFailedPhase | null {
  if (!value) return null
  if (isDownloadFailedPhase(value)) return value
  return LEGACY_FAILED_PHASE[value] ?? 'unknown'
}

/** 签名环境探测（诊断展示，不含 Cookie / 签名头明文） */
export interface DownloadSignProbeDebug {
  pythonAvailable?: boolean
  xhshowInstalled?: boolean
  hasA1?: boolean
  hasAccessTokenArk?: boolean
  authorizationOk?: boolean
}

/** 单张表的 API / 下载诊断摘要 */
export interface DownloadApiDebugItem {
  enabledSign?: boolean
  signOk?: boolean
  apiOk?: boolean
  gotFileUrl?: boolean
  downloadedXlsx?: boolean
  failedPhase?: DownloadFailedPhase
  taskId?: string
  xhsTaskId?: string
  fileName?: string
  fileSize?: number
  durationMs?: number
  message?: string
  httpStatus?: number
  xhsCode?: number
  xhsSuccess?: boolean
  xhsMsg?: string
  lastState?: string
  lastProgress?: number
  lastTaskMessage?: string
  signProbe?: DownloadSignProbeDebug
}

export type DownloadDebugTableKey =
  | 'order'
  | 'live'
  | 'pendingSettlement'
  | 'settledSettlement'

export interface TaskApiDebugEnvelope {
  order?: DownloadApiDebugItem
  live?: DownloadApiDebugItem
  pendingSettlement?: DownloadApiDebugItem
  settledSettlement?: DownloadApiDebugItem
}

export const DOWNLOAD_DEBUG_TABLE_KEYS: DownloadDebugTableKey[] = [
  'order',
  'live',
  'pendingSettlement',
  'settledSettlement',
]

export const FAILED_PHASE_LABELS: Record<DownloadFailedPhase, string> = {
  sign: '签名',
  api: '接口',
  poll: '轮询',
  file_url: 'file_url',
  download: '下载',
  validate: '校验',
  config: '配置',
  timeout: '超时',
  unknown: '未知',
}
