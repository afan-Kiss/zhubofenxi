import { prisma } from '../../lib/prisma'
import { getApiDefinition } from './xhs-api-registry'
import type { XhsApiKey, XhsSyncStep } from './xhs-api-types'
import { XHS_SYNC_STEP_LABELS } from './xhs-api-types'

const PRESET_LABELS: Record<string, string> = {
  today: '当天',
  yesterday: '昨天',
  last7: '最近7天',
  last7days: '最近7天',
  last15: '最近15天',
  last15days: '最近15天',
  thisMonth: '本月',
  lastMonth: '上月',
  custom: '自定义',
}

export const ORDER_LIST_PROGRESS_MIN = 10
export const ORDER_LIST_PROGRESS_MAX = 24

export function presetToRangeLabel(preset: string): string {
  return PRESET_LABELS[preset] ?? preset
}

export function computeOrderListProgressPercent(
  currentPage: number,
  totalPage?: number | null,
): number {
  if (currentPage <= 0) return ORDER_LIST_PROGRESS_MIN
  if (totalPage != null && totalPage > 0) {
    const ratio = Math.min(1, currentPage / totalPage)
    return (
      ORDER_LIST_PROGRESS_MIN +
      Math.floor(ratio * (ORDER_LIST_PROGRESS_MAX - ORDER_LIST_PROGRESS_MIN))
    )
  }
  return Math.min(
    ORDER_LIST_PROGRESS_MAX - 1,
    ORDER_LIST_PROGRESS_MIN + Math.min(13, currentPage),
  )
}

export function formatOrderListApiLabel(
  page: number,
  totalPage?: number | null,
  orderCount?: number,
): string {
  if (totalPage != null && totalPage > 0) {
    return `订单列表 第 ${page} / ${totalPage} 页`
  }
  if (orderCount != null && orderCount > 0) {
    return `订单列表 已读取 ${orderCount} 笔`
  }
  if (page > 0) return `订单列表 第 ${page} 页`
  return '订单列表'
}

export function buildPageStepLabel(
  rangeLabel: string,
  apiLabel: string,
  page: number,
  totalPage?: number | null,
): string {
  const suffix =
    totalPage != null && totalPage > 0
      ? `，第 ${page} / ${totalPage} 页`
      : `，第 ${page} 页`
  return `正在获取${rangeLabel}${apiLabel}${suffix}`
}

export interface SyncProgressReporter {
  beforeRequest: (
    apiKey: XhsApiKey,
    page: number,
    totalPage?: number | null,
  ) => Promise<void>
  afterRequest: (success: boolean) => Promise<void>
  afterPage: (
    apiKey: XhsApiKey,
    page: number,
    totalPage: number | null | undefined,
    orderCount: number,
  ) => Promise<void>
  setStep: (
    step: XhsSyncStep,
    progress: number,
    label?: string,
    extra?: Record<string, unknown>,
  ) => Promise<void>
}

export function createSyncProgressReporter(
  jobId: string,
  rangeLabel: string,
): SyncProgressReporter {
  let successRequestCount = 0
  let failedRequestCount = 0
  let totalRequestCount = 0

  const flush = async (data: Record<string, unknown>) => {
    await prisma.xhsSyncJob.update({
      where: { id: jobId },
      data,
    })
  }

  return {
    async setStep(step, progress, label, extra) {
      await flush({
        currentStep: step,
        progress,
        currentStepLabel: label ?? XHS_SYNC_STEP_LABELS[step],
        rangeLabel,
        ...extra,
      })
    },

    async beforeRequest(apiKey, page, totalPage) {
      const def = getApiDefinition(apiKey)
      const isOrderList = apiKey === 'order_list'
      const progress = isOrderList
        ? computeOrderListProgressPercent(page, totalPage)
        : undefined
      const apiLabel = isOrderList
        ? formatOrderListApiLabel(page, totalPage)
        : def.name
      const label = buildPageStepLabel(rangeLabel, def.name, page, totalPage)
      await flush({
        currentApiKey: apiKey,
        currentApiLabel: apiLabel,
        currentPage: page,
        totalPage: totalPage ?? null,
        currentStep: isOrderList ? 'syncing_order_list' : undefined,
        currentStepLabel: label,
        ...(progress != null ? { progress } : {}),
        successRequestCount,
        failedRequestCount,
        ...(totalRequestCount > 0 ? { totalRequestCount } : {}),
      })
    },

    async afterRequest(success) {
      totalRequestCount++
      if (success) successRequestCount++
      else failedRequestCount++
      await flush({
        successRequestCount,
        failedRequestCount,
        totalRequestCount,
      })
    },

    async afterPage(apiKey, page, totalPage, orderCount) {
      if (apiKey !== 'order_list') return
      const progress = computeOrderListProgressPercent(page, totalPage)
      await flush({
        currentStep: 'syncing_order_list',
        currentStepLabel: XHS_SYNC_STEP_LABELS.syncing_order_list,
        currentPage: page,
        totalPage: totalPage ?? null,
        orderCount,
        progress,
        currentApiLabel: formatOrderListApiLabel(page, totalPage, orderCount),
        currentApiKey: 'order_list',
      })
    },
  }
}
