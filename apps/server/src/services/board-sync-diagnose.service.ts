import { prisma } from '../lib/prisma'
import {
  computeEffectiveCoverageEndMs,
  resolveBusinessRange,
  type BusinessRangePreset,
} from '../utils/business-range'
import { getBusinessSyncStatus } from './business-sync-scheduler.service'
import { getBusinessCacheDebugInfo, getBusinessBoardCache } from './business-cache.service'
import { getCookieHealthPayload, getLastAuthError } from './live-account.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import { buildQualityRefundMonthDiagnostic } from './quality-refund-month-diagnostic.service'
import { bootstrapQualityBadCaseCache } from './quality-badcase-store.service'
import { buildAnchorQualityRefundAttributionDiagnostic } from './quality-refund-anchor-attribution.service'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'

function parsePayTimeFromRaw(rawJson: unknown): Date | null {
  if (rawJson == null) return null
  try {
    const raw =
      typeof rawJson === 'string'
        ? (JSON.parse(rawJson) as Record<string, unknown>)
        : (rawJson as Record<string, unknown>)
    for (const k of ['pay_time', 'payTime', 'paid_at', 'paidAt', 'payment_time', 'paymentTime']) {
      const v = raw[k]
      if (v == null || v === '' || v === 0) continue
      const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
      if (!Number.isNaN(d.getTime())) return d
    }
  } catch {
    /* ignore */
  }
  return null
}

export async function buildBoardSyncDiagnose(params: {
  preset?: string
  startDate?: string
  endDate?: string
}) {
  const preset = (params.preset ?? 'thisMonth') as BusinessRangePreset
  const range = resolveBusinessRange(preset, params.startDate, params.endDate)
  const syncMeta = await getBusinessSyncStatus()
  const cacheInfo = getBusinessCacheDebugInfo(preset, range.startDate, range.endDate)
  const cacheEntry = getBusinessBoardCache(preset, range.startDate, range.endDate)

  const [orderAgg, lastSuccessJob, runningJob, latestFailedJob, totalCount, buyerCache] =
    await Promise.all([
      prisma.xhsRawOrder.aggregate({
        _count: true,
        _min: { orderTime: true },
        _max: { orderTime: true },
      }),
      prisma.xhsSyncJob.findFirst({
        where: {
          preset: 'daily_strategy',
          status: { in: ['success', 'partial_success', 'success_empty'] },
        },
        orderBy: { finishedAt: 'desc' },
      }),
      prisma.xhsSyncJob.findFirst({
        where: { preset: 'daily_strategy', status: 'running' },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.xhsSyncJob.findFirst({
        where: { preset: 'daily_strategy', status: 'failed' },
        orderBy: { finishedAt: 'desc' },
      }),
      prisma.xhsRawOrder.count(),
      prisma.buyerRankingCache.findUnique({ where: { id: 'default' }, select: { updatedAt: true } }),
    ])

  const sampleRows = await prisma.xhsRawOrder.findMany({
    take: 2000,
    select: { orderTime: true, rawJson: true },
    orderBy: { orderTime: 'desc' },
  })

  let orderCountByPayTime = 0
  let orderCountByOrderTime = 0
  let payMin: Date | null = null
  let payMax: Date | null = null
  for (const row of sampleRows) {
    const pay = parsePayTimeFromRaw(row.rawJson)
    if (pay) {
      const ms = pay.getTime()
      if (ms >= range.startTimeMs && ms <= range.endTimeMs) orderCountByPayTime++
      if (!payMin || pay < payMin) payMin = pay
      if (!payMax || pay > payMax) payMax = pay
    }
    if (row.orderTime) {
      const ms = row.orderTime.getTime()
      if (ms >= range.startTimeMs && ms <= range.endTimeMs) orderCountByOrderTime++
    }
  }

  const effectiveCoverageEnd = new Date(
    computeEffectiveCoverageEndMs({
      endDate: range.endDate,
      lastSuccessAt: syncMeta.businessSync.lastSuccessAt,
      dataMaxTime: orderAgg._max.orderTime,
    }),
  ).toISOString()

  const analyzedOrderCount = cacheEntry?.orderCount ?? 0
  const jobCoversRange =
    lastSuccessJob?.startDate && lastSuccessJob?.endDate
      ? lastSuccessJob.startDate <= range.startDate &&
        lastSuccessJob.endDate >= range.endDate.slice(0, 10)
      : false

  const reasonWhenNoData =
    analyzedOrderCount === 0
      ? totalCount === 0
        ? '本地无任何订单 raw 数据'
        : orderCountByPayTime === 0
          ? '当前范围内无已支付订单（按 payTime）'
          : '经营缓存未命中或分析后无有效订单'
      : null

  const cookieHealthPayload = await getCookieHealthPayload()
  const lastAuthErrorRaw = await getLastAuthError()
  const lastAuthError = lastAuthErrorRaw
    ? {
        liveAccountName: lastAuthErrorRaw.liveAccountName,
        api: lastAuthErrorRaw.api,
        errorCode: lastAuthErrorRaw.errorCode,
        message: lastAuthErrorRaw.message,
      }
    : null

  await bootstrapQualityBadCaseCache().catch(() => {
    /* 诊断页允许品退缓存加载失败 */
  })
  const allViews = cacheEntry?.views ?? []
  const coreViews = filterViewsForCoreMetrics(allViews)
  const qualityRefundDiagnostic = buildQualityRefundMonthDiagnostic({
    views: coreViews,
    allViews,
    startDate: range.startDate,
    endDate: range.endDate,
  })
  const dateRange = resolveDateRange(preset as DateRangePreset, range.startDate, range.endDate)
  const liveBundle = await buildRawAnalyzeBundle(dateRange)
  const boardQualityReturnCount = Number(cacheEntry?.summary?.qualityReturnCount ?? 0)
  const anchorQualityRefundAttributionDiagnostic = await buildAnchorQualityRefundAttributionDiagnostic({
    views: coreViews,
    liveSessions: liveBundle?.liveSessions ?? [],
    boardQualityReturnCount,
  })

  return {
    requestedRange: { preset, startDate: params.startDate, endDate: params.endDate },
    resolvedRange: {
      preset,
      startDate: range.startDate,
      endDate: range.endDate,
      startTimeMs: range.startTimeMs,
      endTimeMs: range.endTimeMs,
    },
    effectiveCoverageEnd,
    lastSuccessBusinessSync: lastSuccessJob
      ? {
          id: lastSuccessJob.id,
          status: lastSuccessJob.status,
          startDate: lastSuccessJob.startDate,
          endDate: lastSuccessJob.endDate,
          finishedAt: lastSuccessJob.finishedAt?.toISOString() ?? null,
          jobCoversRange,
        }
      : null,
    runningBusinessSync: runningJob
      ? {
          id: runningJob.id,
          startedAt: runningJob.startedAt?.toISOString() ?? null,
          startDate: runningJob.startDate,
          endDate: runningJob.endDate,
        }
      : null,
    nextBusinessSyncAt: syncMeta.businessSync.nextRunAt,
    businessCacheHit: cacheInfo.businessCacheHit,
    businessCacheBuiltAt: cacheInfo.businessCacheBuiltAt,
    sourceSyncJobId: cacheInfo.sourceSyncJobId,
    cacheBuildDurationMs: cacheEntry?.buildDurationMs ?? null,
    orderCountByPayTime,
    orderCountByOrderTime,
    analyzedOrderCount,
    rawOrderMinPayTime: payMin?.toISOString() ?? null,
    rawOrderMaxPayTime: payMax?.toISOString() ?? null,
    rawOrderMinOrderTime: orderAgg._min.orderTime?.toISOString() ?? null,
    rawOrderMaxOrderTime: orderAgg._max.orderTime?.toISOString() ?? null,
    buyerRankingLastBuiltAt: buyerCache?.updatedAt?.toISOString() ?? null,
    buyerRankingIncludedIn30MinSync: false,
    settlementIncludedInBusinessSync: false,
    settlementSkippedForBusinessBI: true,
    coverageCheckResult: {
      totalRawOrders: totalCount,
      payTimeRequiredForGmv: true,
    },
    reasonWhenNoData,
    lastSuccessSyncAt: syncMeta.businessSync.lastSuccessAt,
    cookieHealth: {
      ...cookieHealthPayload.summary,
      accounts: cookieHealthPayload.accounts,
    },
    lastAuthError,
    businessSyncBlockedByCookie:
      cookieHealthPayload.summary.enabledCount > 0 &&
      cookieHealthPayload.summary.validCount === 0 &&
      cookieHealthPayload.summary.invalidCount > 0,
    qualityRefundDiagnostic: {
      officialMatchedInPeriodCount: qualityRefundDiagnostic.officialMatchedInPeriodCount,
      suspectedQualityRefundInPeriodCount:
        qualityRefundDiagnostic.suspectedQualityRefundInPeriodCount,
      unmatchedOfficialInPeriodCount: qualityRefundDiagnostic.unmatchedOfficialInPeriodCount,
      excludedByLowPriceBrushCount: qualityRefundDiagnostic.excludedByLowPriceBrushCount,
      excludedByPayTimeOutOfPeriodCount:
        qualityRefundDiagnostic.excludedByPayTimeOutOfPeriodCount,
      periodQualityRefundOrderCount: qualityRefundDiagnostic.periodQualityRefundOrderCount,
      summaryQualityReturnCount: Number(cacheEntry?.summary?.qualityReturnCount ?? 0),
      note: qualityRefundDiagnostic.note,
      excludeSamples: qualityRefundDiagnostic.excludeSamples,
    },
    anchorQualityRefundAttributionDiagnostic,
  }
}
