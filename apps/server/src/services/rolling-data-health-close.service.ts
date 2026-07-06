import type { AnalyzedOrderView } from '../types/analysis'
import { LOCAL_VIEWER_USER } from '../constants/local-viewer'
import { prisma } from '../lib/prisma'
import {
  addDaysShanghai,
  formatDateKeyShanghai,
  startOfDayMsShanghai,
} from '../utils/business-timezone'
import { logError, logInfo } from '../utils/server-log'
import { calculateBusinessMetrics } from './business-metrics.service'
import {
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from './board-scoped-views.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import {
  acquireRollingDataHealthCloseLock,
  appendRollingDataHealthCloseRunLog,
  rollingDataHealthCloseReportFileKey,
  writeRollingDataHealthCloseReport,
  type RollingDataHealthCloseReport,
} from './rolling-data-health-close-store.service'

export function resolveRollingDataHealthCloseRange(asOfDateKey?: string): {
  startDate: string
  endDate: string
  dataRangeLabel: string
  dayCount: number
} {
  const today = asOfDateKey ?? formatDateKeyShanghai()
  const rangeEnd = addDaysShanghai(today, -15)
  const rangeStart = addDaysShanghai(rangeEnd, -29)
  const dayCount =
    Math.round(
      (startOfDayMsShanghai(rangeEnd) - startOfDayMsShanghai(rangeStart)) / 86_400_000,
    ) + 1
  const dataRangeLabel = `${rangeStart} ~ ${rangeEnd}（滚动30天，延迟15天）`
  return { startDate: rangeStart, endDate: rangeEnd, dataRangeLabel, dayCount }
}

function countDuplicateOrderRisk(views: AnalyzedOrderView[]): number {
  const orderIds = new Map<string, number>()
  for (const v of views) {
    const orderNo = resolveMetricOrderNo(v)
    if (orderNo) orderIds.set(orderNo, (orderIds.get(orderNo) ?? 0) + 1)
  }
  let duplicateOrderCount = 0
  for (const c of orderIds.values()) {
    if (c > 1) duplicateOrderCount += c - 1
  }
  return duplicateOrderCount
}

function countUnassignedOrders(views: AnalyzedOrderView[]): number {
  const unassigned = views.filter((v) => {
    const name = v.anchorName?.trim() || '未归属'
    return name === '未归属' || v.attributionType === 'unassigned'
  })
  return dedupeViewsByMetricOrderNo(unassigned).length
}

function buildWarnings(input: {
  afterSaleRelatedOrderCount: number
  afterSaleSignalRecordCount: number
  afterSaleCacheRecordCount: number
  qualityRefundOrderCount: number
  unassignedOrderCount: number
  duplicateOrderCount: number
}): string[] {
  const warnings: string[] = []
  if (input.afterSaleRelatedOrderCount === 0) {
    warnings.push('售后相关订单可能偏低')
  }
  if (input.afterSaleSignalRecordCount === 0) {
    warnings.push('售后信号记录可能偏低')
  }
  if (input.afterSaleCacheRecordCount === 0) {
    warnings.push('售后缓存记录可能未同步')
  }
  if (input.qualityRefundOrderCount === 0) {
    warnings.push('官方品退可能未同步')
  }
  if (input.unassignedOrderCount > 0) {
    warnings.push(`有 ${input.unassignedOrderCount} 单暂未归到主播，请检查主播归属`)
  }
  if (input.duplicateOrderCount > 0) {
    warnings.push(`发现 ${input.duplicateOrderCount} 条重复订单风险`)
  }
  return warnings
}

async function countAfterSaleCacheRecords(): Promise<{
  count: number
  scope: 'all_db' | 'range'
}> {
  // 售后工作台缓存表无可靠订单支付时间字段，按全库统计
  const count = await prisma.xhsAfterSalesWorkbenchCache.count()
  return { count, scope: 'all_db' }
}

export async function buildRollingDataHealthCloseReport(input: {
  triggeredBy: string
  asOfDateKey?: string
}): Promise<RollingDataHealthCloseReport> {
  const range = resolveRollingDataHealthCloseRange(input.asOfDateKey)
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: range.startDate,
    endDate: range.endDate,
    role: LOCAL_VIEWER_USER.role,
    username: LOCAL_VIEWER_USER.username,
  })
  const coreViews = filterViewsForCoreMetrics(scoped.views)
  const metrics = calculateBusinessMetrics(coreViews, { scope: 'rolling-data-health-close' })
  const performanceViews = await getAnchorPerformanceViews(coreViews, scoped.rawByMatch)
  const unassignedOrderCount = countUnassignedOrders(performanceViews)
  const duplicateOrderCount = countDuplicateOrderRisk(coreViews)
  const afterSaleCache = await countAfterSaleCacheRecords()

  return {
    generatedAt: new Date().toISOString(),
    triggeredBy: input.triggeredBy,
    startDate: range.startDate,
    endDate: range.endDate,
    dataRangeLabel: range.dataRangeLabel,
    gmvAmountYuan: metrics.totalGmv,
    actualSignedAmountYuan: metrics.actualSignedAmount,
    paidOrderCount: metrics.orderCount,
    signedOrderCount: metrics.signedOrderCount,
    signRate: metrics.signRate,
    refundAmountYuan: metrics.refundAmount,
    refundOrderCount: metrics.refundOrderCount,
    refundRate: metrics.refundRate,
    qualityRefundOrderCount: metrics.qualityRefundOrderCount,
    qualityRefundRate: metrics.qualityRefundRate,
    afterSaleRecordCount: metrics.afterSaleRecordCount,
    afterSaleRelatedOrderCount: metrics.afterSaleRelatedOrderCount,
    afterSaleSignalRecordCount: metrics.afterSaleRecordCount,
    afterSaleCacheRecordCount: afterSaleCache.count,
    afterSaleCacheRecordScope: afterSaleCache.scope,
    unassignedOrderCount,
    duplicateOrderCount,
    warnings: buildWarnings({
      afterSaleRelatedOrderCount: metrics.afterSaleRelatedOrderCount,
      afterSaleSignalRecordCount: metrics.afterSaleRecordCount,
      afterSaleCacheRecordCount: afterSaleCache.count,
      qualityRefundOrderCount: metrics.qualityRefundOrderCount,
      unassignedOrderCount,
      duplicateOrderCount,
    }),
  }
}

function formatMoneyLog(yuan: number): string {
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export async function runRollingDataHealthClose(input: {
  triggeredBy: string
  asOfDateKey?: string
}): Promise<RollingDataHealthCloseReport> {
  const range = resolveRollingDataHealthCloseRange(input.asOfDateKey)
  const rangeKey = rollingDataHealthCloseReportFileKey(range.startDate, range.endDate)
  const startedAt = new Date().toISOString()
  let releaseLock: (() => Promise<void>) | null = null
  logInfo('滚动30天数据健康结账', '滚动30天数据健康结账开始')
  try {
    releaseLock = await acquireRollingDataHealthCloseLock(rangeKey, input.triggeredBy)
    const report = await buildRollingDataHealthCloseReport(input)
    const reportPath = await writeRollingDataHealthCloseReport(report)
    await appendRollingDataHealthCloseRunLog({
      task: 'rolling-data-health-close',
      startDate: report.startDate,
      endDate: report.endDate,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'pass',
      reportPath,
    })
    logInfo(
      '滚动30天数据健康结账',
      `滚动30天数据健康结账完成：${report.startDate}~${report.endDate}，已签收 ${formatMoneyLog(report.actualSignedAmountYuan)}，GMV ${formatMoneyLog(report.gmvAmountYuan)}，退款 ${formatMoneyLog(report.refundAmountYuan)}`,
    )
    return report
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await appendRollingDataHealthCloseRunLog({
      task: 'rolling-data-health-close',
      startDate: range.startDate,
      endDate: range.endDate,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      errorMessage: message,
    })
    logError('滚动30天数据健康结账', `滚动30天数据健康结账失败：${message}`, err)
    throw err
  } finally {
    if (releaseLock) {
      await releaseLock()
    }
  }
}

export type { RollingDataHealthCloseReport } from './rolling-data-health-close-store.service'
