export type DownloadType = 'order' | 'live' | 'pendingSettlement' | 'settledSettlement'



export type DownloadMode = 'auto_export' | 'direct_url'



export const DOWNLOAD_TYPE_LABELS: Record<DownloadType, string> = {

  order: '当月订单表',

  live: '直播场次表',

  pendingSettlement: '待结算明细',

  settledSettlement: '已结算明细',

}



export const DOWNLOAD_MODE_LABELS: Record<DownloadMode, string> = {
  auto_export: '自动导出',
  direct_url: '临时链接下载',
}



export interface CredentialPublic {

  platformName: string

  hasCookie: boolean

  remark: string | null

  updatedAt: string

}



export interface DownloadConfigItem {

  id: string

  type: DownloadType

  name: string

  url: string

  method: string

  mode: DownloadMode

  sellerId: string | null

  enabled: boolean

  remark: string | null

  updatedAt: string

}



export interface DownloadTaskItem {

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



export function formatFileSize(bytes: number | null): string {

  if (bytes == null) return '—'

  if (bytes < 1024) return `${bytes} B`

  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`

}



export function statusLabel(status: string): string {

  switch (status) {

    case 'success':

      return '成功'

    case 'failed':

      return '失败'

    case 'downloading':

      return '下载中'

    case 'pending':

      return '等待'

    default:

      return status

  }

}



export function modeLabel(mode: string | null): string {

  if (mode === 'auto_export') return DOWNLOAD_MODE_LABELS.auto_export

  if (mode === 'direct_url') return DOWNLOAD_MODE_LABELS.direct_url

  return mode ?? '—'

}

