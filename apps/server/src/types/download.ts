export const DOWNLOAD_TYPES = [
  'order',
  'live',
  'pendingSettlement',
  'settledSettlement',
] as const

export type DownloadType = (typeof DOWNLOAD_TYPES)[number]

export type DownloadMode = 'auto_export' | 'direct_url'

export function isDownloadMode(value: string): value is DownloadMode {
  return value === 'auto_export' || value === 'direct_url'
}

export const DOWNLOAD_TYPE_LABELS: Record<DownloadType, string> = {
  order: '当月订单表',
  live: '直播场次表',
  pendingSettlement: '待结算明细',
  settledSettlement: '已结算明细',
}

export const DOWNLOAD_STATUSES = [
  'idle',
  'waiting',
  'pending',
  'exporting',
  'polling',
  'downloading',
  'success',
  'failed',
] as const

export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number]

export function isDownloadType(value: string): value is DownloadType {
  return (DOWNLOAD_TYPES as readonly string[]).includes(value)
}

export const DEFAULT_DOWNLOAD_CONFIGS: Array<{
  type: DownloadType
  name: string
}> = [
  { type: 'order', name: '当月订单表' },
  { type: 'live', name: '直播场次表' },
  { type: 'pendingSettlement', name: '待结算明细' },
  { type: 'settledSettlement', name: '已结算明细' },
]
