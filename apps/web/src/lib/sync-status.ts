import type { DateRangePreset } from './date-range'

export type SyncOutcome = 'success' | 'success_empty' | 'preview_only' | 'failed'

export interface SyncValidationCheckItem {
  label: string
  status: '通过' | '警告' | '失败' | '缺失'
  detail: string | null
}

export interface SyncValidationSummary {
  outcome: SyncOutcome
  trustStatus: string
  message: string
  apiCollection: Array<{ label: string; status: string; count: number }>
  normalization: {
    orderCount: number
    abnormalOrderCount: number
    liveSessionCount: number
    pendingCount: number
    settledCount: number
  }
  checks: SyncValidationCheckItem[]
  previewReasons: string[]
  failedStage: string | null
  failedReason: string | null
  suggestion: string | null
}

export interface SyncJobView {
  id: string
  syncJobId: string
  type: string
  preset: string
  startDate: string
  endDate: string
  status: string
  progress: number
  currentStep: string
  currentStepLabel: string
  currentPage: number
  totalPage: number | null
  currentApiKey: string | null
  currentApiLabel: string | null
  rangeLabel: string | null
  totalRequestCount: number
  successRequestCount: number
  failedRequestCount: number
  orderCount: number
  liveSessionCount: number
  pendingCount: number
  settledCount: number
  errorMessage: string | null
  startedBy: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  createdAt: string
  updatedAt?: string | null
  runningSeconds?: number | null
  isStaleRunning?: boolean
  isRunning: boolean
  empty?: boolean
  outcome?: SyncOutcome | null
  trustStatus?: string | null
  validationSummary?: SyncValidationSummary | null
}

export interface SyncStatusResponse {
  running: boolean
  job: SyncJobView | null
  latest?: SyncJobView | null
}

export function toApiPreset(preset: DateRangePreset): string {
  if (preset === 'last15') return 'last15days'
  return preset
}

export function formatSyncDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return `${min} 分 ${rem} 秒`
}

export function formatSyncElapsed(startedAt: string | null | undefined): string {
  if (!startedAt) return '—'
  const ms = Date.now() - new Date(startedAt).getTime()
  return formatSyncDuration(ms)
}

export function estimateRemainingMs(
  progress: number,
  startedAt: string | null,
): number | null {
  if (!startedAt || progress <= 0 || progress >= 100) return null
  const elapsed = Date.now() - new Date(startedAt).getTime()
  const total = elapsed / (progress / 100)
  return Math.max(0, Math.round(total - elapsed))
}

export function mapSyncErrorMessage(msg: string | null | undefined): string {
  if (!msg) return '同步失败，请查看同步历史或等待下一周期自动重试'
  if (msg.includes('Cookie') || msg.includes('登录')) {
    return '小红书登录状态可能已失效，请重新复制 Cookie'
  }
  if (msg.includes('签名') || msg.includes('xhshow') || msg.includes('a1')) {
    return '小红书签名失败，请检查 Cookie、a1、access-token 和 xhshow'
  }
  if (msg.includes('尚未配置') || msg.includes('接口未配置')) {
    return '小红书接口尚未配置，请联系管理员'
  }
  if (msg.includes('频率') || msg.includes('429')) {
    return '请求频率受限，系统已暂停，请稍后重试'
  }
  if (msg.includes('暂无订单') || msg.includes('没有数据') || msg.includes('无订单')) {
    return '接口同步已完成，当前范围暂无订单数据'
  }
  return msg
}

export const PRESET_DISPLAY: Record<string, string> = {
  today: '当天',
  yesterday: '昨天',
  last15: '最近15天',
  last15days: '最近15天',
  last7: '最近7天',
  last7days: '最近7天',
  thisMonth: '本月',
  lastMonth: '上月',
  custom: '自定义',
}

export type DataStatusKind =
  | 'synced'
  | 'empty'
  | 'syncing'
  | 'failed'
  | 'historical'

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

export function deriveDashboardStatus(input: {
  hasData: boolean
  rangeLabel: string
  preset: string
  lastSyncAt: string | null
  syncRunning: boolean
  syncJob: SyncJobView | null
  dataSource: string
  intervalMinutes?: number
  autoSyncEnabled?: boolean
}): {
  dataStatus: DataStatusKind
  dataSourceLabel: string
  hint: string
} {
  const presetText = PRESET_DISPLAY[input.preset] ?? input.rangeLabel
  const intervalMinutes = input.intervalMinutes ?? 180
  const autoSyncEnabled = input.autoSyncEnabled !== false

  if (input.syncRunning) {
    return {
      dataStatus: 'syncing',
      dataSourceLabel: input.hasData ? '最近一次快照' : '暂无数据',
      hint: `正在同步【${presetText}】数据，请稍候，页面可继续浏览。`,
    }
  }

  if (input.hasData) {
    return {
      dataStatus: 'synced',
      dataSourceLabel: '接口采集数据',
      hint: `当前显示的是【${presetText}】本地已同步数据，最近同步时间：${formatTime(input.lastSyncAt)}。切换日期仅查看本地聚合结果，不会触发远程同步。`,
    }
  }

  const job = input.syncJob
  const isEmptySuccess =
    job &&
    !job.isRunning &&
    (job.status === 'success_empty' || job.empty || job.outcome === 'success_empty')

  if (isEmptySuccess) {
    return {
      dataStatus: 'empty',
      dataSourceLabel: '接口同步已完成',
      hint: `【${presetText}】没有查询到订单数据。接口同步已完成，暂无可生成的经营看板。`,
    }
  }

  const failedForRange =
    job &&
    !job.isRunning &&
    (job.status === 'failed' || job.status === 'failed_timeout')

  if (failedForRange && job) {
    return {
      dataStatus: 'failed',
      dataSourceLabel: '暂无数据',
      hint: `同步失败：${mapSyncErrorMessage(job.errorMessage)}`,
    }
  }

  return {
    dataStatus: 'empty',
    dataSourceLabel: '暂无数据',
    hint: autoSyncEnabled
      ? `当前范围暂无已同步数据，请等待系统自动同步（经营数据约每 ${intervalMinutes} 分钟）后再查看。`
      : '当前范围暂无已同步数据；经营数据自动同步已关闭，请到系统设置开启或手动同步。',
  }
}

export function syncCompletionMessage(job: SyncJobView | null): string | null {
  if (!job || job.isRunning) return null
  const presetText = PRESET_DISPLAY[job.preset] ?? job.preset
  if (job.status === 'success_empty' || job.empty || job.outcome === 'success_empty') {
    return `同步完成，【${presetText}】暂无订单数据。`
  }
  if (job.outcome === 'preview_only' || job.status === 'partial_success') {
    const reasons = job.validationSummary?.previewReasons?.slice(0, 2).join('；')
    return reasons
      ? `同步完成，但当前数据仅供预览：${reasons}`
      : `同步完成，但当前数据仅供预览，请查看数据诊断。`
  }
  if (job.status === 'success') {
    return `同步完成，【${presetText}】数据已更新。`
  }
  if (job.status === 'failed') {
    const reason =
      job.validationSummary?.failedReason ??
      mapSyncErrorMessage(job.errorMessage)
    return `同步失败：${reason}`
  }
  return null
}
