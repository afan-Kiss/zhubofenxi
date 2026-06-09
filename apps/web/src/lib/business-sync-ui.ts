import type { SyncJobView } from './sync-status'
import { formatSyncElapsed } from './sync-status'
import type { BoardSyncMeta, BoardActiveSyncJob } from './board-live-query'

export const BOARD_DATA_SOURCE_LABEL =
  '数据来源：订单、直播场次、售后、商品问题售后接口的本地同步结果'

export type BoardSyncUiMode =
  | 'synced_idle'
  | 'syncing_with_data'
  | 'first_sync'
  | 'empty_idle'
  | 'empty_failed'
  | 'loading_range'

const SETTLEMENT_STEPS = new Set([
  'syncing_pending_settlement',
  'syncing_settled_settlement',
  'syncing_settlement_detail',
])

const ORDER_LIST_PROGRESS_MIN = 10
const ORDER_LIST_PROGRESS_MAX = 24

const STEP_PROGRESS_ESTIMATE: Record<string, number> = {
  idle: 3,
  syncing_order_stats: 8,
  syncing_order_list: 10,
  syncing_order_detail: 25,
  syncing_live_list: 40,
  syncing_live_detail: 50,
  syncing_quality_badcase: 78,
  normalizing_data: 65,
  analyzing_business: 95,
  saving_snapshot: 98,
  completed: 100,
  failed: 0,
}

/** 订单列表阶段超过此秒数视为接口响应较慢 */
export const SYNC_ORDER_LIST_SLOW_SECONDS = 90

type SyncJobLike = SyncJobView | BoardActiveSyncJob | null

export function isBusinessSyncActive(
  status: BoardSyncMeta['businessSync']['status'] | undefined,
): boolean {
  return status === 'running' || status === 'queued'
}

export function computeOrderListProgressPercent(job: SyncJobLike): number {
  if (!job) return ORDER_LIST_PROGRESS_MIN
  const page = job.currentPage ?? 0
  const total = job.totalPage
  if (page > 0 && total != null && total > 0) {
    const ratio = Math.min(1, page / total)
    return ORDER_LIST_PROGRESS_MIN + Math.floor(ratio * (ORDER_LIST_PROGRESS_MAX - ORDER_LIST_PROGRESS_MIN))
  }
  if (job.progress > ORDER_LIST_PROGRESS_MIN && job.progress <= ORDER_LIST_PROGRESS_MAX) {
    return job.progress
  }
  if (job.orderCount > 0) {
    return Math.min(ORDER_LIST_PROGRESS_MAX - 1, ORDER_LIST_PROGRESS_MIN + Math.min(13, Math.floor(job.orderCount / 30)))
  }
  if (page > 0) {
    return Math.min(ORDER_LIST_PROGRESS_MAX - 1, ORDER_LIST_PROGRESS_MIN + Math.min(13, page))
  }
  return ORDER_LIST_PROGRESS_MIN
}

export function resolveSyncProgressPercent(job: SyncJobLike): number {
  if (!job) return 0
  if (job.currentStep === 'syncing_order_list') {
    return computeOrderListProgressPercent(job)
  }
  if (job.progress > 0 && job.progress <= 100) return job.progress
  const step = job.currentStep
  if (SETTLEMENT_STEPS.has(step)) {
    return STEP_PROGRESS_ESTIMATE.analyzing_business ?? 95
  }
  return STEP_PROGRESS_ESTIMATE[step] ?? 5
}

export function resolveReadingStepLabel(job: SyncJobLike): string {
  if (!job) return '准备同步'
  if (job.currentApiLabel?.trim()) {
    const label = job.currentApiLabel.trim()
    if (label.startsWith('订单列表')) return '订单列表'
    return label
  }
  const label = job.currentStepLabel?.trim()
  if (label) {
    if (label.includes('订单列表')) return '订单列表'
    if (label.includes('直播')) return '直播场次'
    if (label.includes('品质') || label.includes('品退')) return '商品问题售后'
    if (label.includes('标准化') || label.includes('追踪')) return '售后数据'
    if (label.includes('经营') || label.includes('看板')) return '经营看板缓存'
    return label.replace(/^正在/, '').trim() || label
  }
  switch (job.currentStep) {
    case 'syncing_order_list':
    case 'syncing_order_detail':
      return '订单列表'
    case 'syncing_live_list':
    case 'syncing_live_detail':
      return '直播场次'
    case 'syncing_quality_badcase':
      return '商品问题售后'
    case 'normalizing_data':
      return '售后数据'
    case 'analyzing_business':
    case 'saving_snapshot':
      return '经营看板缓存'
    default:
      return '经营数据'
  }
}

export function formatReadingPrefix(step: string): string {
  if (step === 'syncing_quality_badcase' || step === 'analyzing_business' || step === 'saving_snapshot') {
    if (step === 'syncing_quality_badcase') return '正在识别'
    return '正在生成'
  }
  return '正在读取'
}

export function formatPageProgress(job: SyncJobLike): string | null {
  if (!job || job.currentPage <= 0) return null
  if (job.totalPage != null && job.totalPage > 0) {
    return `第 ${job.currentPage} / ${job.totalPage} 页`
  }
  return `第 ${job.currentPage} 页`
}

export function formatSyncedCounts(job: SyncJobLike): string {
  if (!job) return '已获取：—'
  const parts: string[] = []
  if (job.orderCount > 0) parts.push(`订单 ${job.orderCount} 笔`)
  if (job.liveSessionCount > 0) parts.push(`直播场次 ${job.liveSessionCount} 场`)
  const afterSales =
    'afterSaleCount' in job ? Number(job.afterSaleCount ?? 0) : 0
  if (afterSales > 0) parts.push(`售后 ${afterSales} 条`)
  const quality =
    'qualityCaseCount' in job ? Number(job.qualityCaseCount ?? 0) : 0
  if (quality > 0) parts.push(`品退 ${quality} 条`)
  return parts.length > 0 ? `已获取：${parts.join(' · ')}` : '已获取：等待首批数据…'
}

export function resolveSyncRunningSeconds(job: SyncJobLike): number | null {
  if (!job) return null
  if ('runningSeconds' in job && job.runningSeconds != null) return job.runningSeconds
  if (!job.startedAt) return null
  return Math.max(0, Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000))
}

export function isOrderListSyncSlow(job: SyncJobLike): boolean {
  if (!job || job.currentStep !== 'syncing_order_list') return false
  const sec = resolveSyncRunningSeconds(job)
  return sec != null && sec >= SYNC_ORDER_LIST_SLOW_SECONDS
}

export function isSyncJobStaleRunning(job: SyncJobLike): boolean {
  if (!job) return false
  if ('isStaleRunning' in job && job.isStaleRunning) return true
  return false
}

export type BusinessSyncCardVariant =
  | 'first_sync'
  | 'syncing_update'
  | 'completed'
  | 'failed'
  | 'empty_idle'

export function resolveProgressCardVariant(input: {
  hasDisplayData: boolean
  businessSync: BoardSyncMeta['businessSync']
  activeSyncJob: BoardActiveSyncJob | null
  totalRawOrders: number
}): BusinessSyncCardVariant {
  const syncing = isBusinessSyncActive(input.businessSync.status)
  if (syncing && !input.hasDisplayData) return 'first_sync'
  if (syncing && input.hasDisplayData) return 'syncing_update'
  if (input.businessSync.status === 'failed' && !input.hasDisplayData && input.totalRawOrders === 0) {
    return 'failed'
  }
  if (!input.hasDisplayData && !syncing) return 'empty_idle'
  if (syncing) return 'syncing_update'
  return 'completed'
}

export function deriveBoardSyncUiMode(input: {
  hasDisplayData: boolean
  businessSync?: BoardSyncMeta['businessSync']
  activeSyncJob?: BoardActiveSyncJob | null
  totalRawOrders?: number
  isLoadingRange?: boolean
}): BoardSyncUiMode {
  if (input.isLoadingRange) return 'loading_range'
  const biz = input.businessSync
  if (!biz) return input.hasDisplayData ? 'synced_idle' : 'empty_idle'

  const syncing = isBusinessSyncActive(biz.status)
  if (biz.status === 'success' && !biz.currentTask && !input.activeSyncJob) {
    return input.hasDisplayData ? 'synced_idle' : 'empty_idle'
  }
  if (syncing && !input.hasDisplayData) return 'first_sync'
  if (syncing && input.hasDisplayData) return 'syncing_with_data'
  if (!input.hasDisplayData && biz.status === 'failed' && !biz.lastSuccessAt) return 'empty_failed'
  if (!input.hasDisplayData && (input.totalRawOrders ?? 0) === 0 && !syncing) return 'empty_idle'
  if (!input.hasDisplayData && !syncing) return 'empty_idle'
  return 'synced_idle'
}

export function formatElapsedFromJob(job: SyncJobLike): string {
  const sec = resolveSyncRunningSeconds(job)
  if (sec == null) return formatSyncElapsed(job?.startedAt)
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return `${min} 分 ${rem} 秒`
}

export function compactSyncHint(job: SyncJobLike): string | null {
  if (!job) return null
  const pct = resolveSyncProgressPercent(job)
  const step = resolveReadingStepLabel(job)
  const parts = [`当前步骤：${step} · 进度 ${pct}%`]
  const page = formatPageProgress(job)
  if (page) parts.push(page)
  const counts = formatSyncedCounts(job)
  if (counts !== '已获取：等待首批数据…') parts.push(counts.replace(/^已获取：/, '已获取：'))
  else if (job.orderCount > 0) parts.push(`已获取：订单 ${job.orderCount} 笔`)
  const elapsed = formatElapsedFromJob(job)
  if (elapsed !== '—') parts.push(`已耗时：${elapsed}`)
  if (isSyncJobStaleRunning(job)) {
    parts.push('接口响应较慢，系统会继续自动处理')
  }
  return parts.join(' · ')
}

export function resolveBusinessSyncCardTitle(
  variant: BusinessSyncCardVariant,
  input?: { totalRawOrders?: number; lastSuccessAt?: string | null },
): string {
  switch (variant) {
    case 'first_sync': {
      const trulyFirst = (input?.totalRawOrders ?? 0) === 0 && !input?.lastSuccessAt
      return trulyFirst ? '首次同步进行中' : '经营数据同步中'
    }
    case 'syncing_update':
      return '经营数据正在更新'
    case 'completed':
      return '同步已完成'
    case 'failed':
      return '同步失败'
    case 'empty_idle':
      return '暂无业务数据'
    default:
      return '经营数据同步'
  }
}

export function resolveBusinessSyncCardDescription(variant: BusinessSyncCardVariant): string {
  switch (variant) {
    case 'first_sync':
      return '正在同步经营数据，完成后自动显示看板。'
    case 'syncing_update':
      return '经营数据正在后台更新，当前展示最近一次成功结果。'
    case 'failed':
      return '业务数据还没有生成，请检查直播号 Cookie 或稍后重试。'
    case 'empty_idle':
      return '当前还没有业务数据，直播号 Cookie 已保留，可以重新同步经营数据。'
    default:
      return ''
  }
}

export function resolveSyncingHeaderMessage(job: SyncJobLike): string {
  if (isOrderListSyncSlow(job) || isSyncJobStaleRunning(job)) {
    return '订单接口响应较慢，当前展示最近一次成功结果，系统会继续自动处理。'
  }
  return '经营数据正在后台更新，当前展示最近一次成功结果。'
}
