import { prisma } from '../lib/prisma'
import { getCookieHealthPayload, type CookieHealthSummary } from './live-account.service'
import { getBusinessSyncStatus } from './business-sync-scheduler.service'
import {
  buildBuyerProfileStatusForApi,
  type BuyerProfileStatusView,
} from './buyer-ranking-cache.service'
import {
  getSyncStatusPayload,
  mapSyncErrorForUser,
  type XhsSyncJobView,
} from './xhs-api-sync/xhs-sync-job.service'
import { isBusinessSyncJobStale } from './business-sync-stale-cleanup.service'
import { readLatestRollingDataHealthCloseReport } from './rolling-data-health-close-store.service'
import type { RollingDataHealthCloseReport } from './rolling-data-health-close-store.service'

export type { BuyerProfileStatusView }

export interface BoardActiveSyncJobView {
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
  afterSaleCount: number
  qualityCaseCount: number
  errorMessage: string | null
  startedBy: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  createdAt: string
  updatedAt: string | null
  runningSeconds: number | null
  isStaleRunning: boolean
  isRunning: boolean
}

function toActiveSyncJobView(
  job: XhsSyncJobView,
  tallies: { afterSaleCount: number; qualityCaseCount: number },
  staleRunning: boolean,
): BoardActiveSyncJobView {
  const runningSeconds = job.startedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(job.startedAt)) / 1000))
    : null
  return {
    id: job.syncJobId,
    syncJobId: job.syncJobId,
    type: job.type,
    preset: job.preset,
    startDate: job.startDate,
    endDate: job.endDate,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    currentStepLabel: job.currentStepLabel,
    currentPage: job.currentPage,
    totalPage: job.totalPage,
    currentApiKey: job.currentApiKey,
    currentApiLabel: job.currentApiLabel,
    rangeLabel: job.rangeLabel,
    totalRequestCount: job.totalRequestCount,
    successRequestCount: job.successRequestCount,
    failedRequestCount: job.failedRequestCount,
    orderCount: job.orderCount,
    liveSessionCount: job.liveSessionCount,
    pendingCount: job.pendingCount,
    settledCount: job.settledCount,
    afterSaleCount: tallies.afterSaleCount,
    qualityCaseCount: tallies.qualityCaseCount,
    errorMessage: job.errorMessage ? mapSyncErrorForUser(job.errorMessage) : null,
    startedBy: job.startedBy,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt ?? null,
    runningSeconds,
    isStaleRunning: staleRunning,
    isRunning: job.isRunning,
  }
}

function buildDegradedCookieHealth(errorMessage: string): {
  accounts: []
  summary: CookieHealthSummary
  degraded: true
  errorMessage: string
} {
  return {
    accounts: [],
    summary: {
      enabledCount: 0,
      validCount: 0,
      invalidCount: 0,
      suspectedCount: 0,
      unknownCount: 0,
      canSyncCount: 0,
      cannotSyncCount: 0,
      missingCookieCount: 0,
      missingA1Count: 0,
      missingArkCount: 0,
      expiredCount: 0,
    },
    degraded: true,
    errorMessage,
  }
}

export interface RollingDataHealthCloseSummary {
  generatedAt: string
  startDate: string
  endDate: string
  rangeLabel: string
  gmvAmountYuan: number
  actualSignedAmountYuan: number
  refundAmountYuan: number
  paidOrderCount: number
  signedOrderCount: number
  refundOrderCount: number
  signRate: number | null
  refundRate: number | null
  qualityRefundOrderCount: number
  qualityRefundRate: number | null
  /** @deprecated 兼容旧字段，等同 afterSaleSignalRecordCount */
  afterSaleRecordCount: number
  afterSaleRelatedOrderCount: number
  afterSaleSignalRecordCount: number
  afterSaleCacheRecordCount: number
  afterSaleCacheRecordScope: 'all_db' | 'range'
  unassignedOrderCount: number
  duplicateOrderCount: number
  warnings: string[]
}

function toRollingDataHealthCloseSummary(
  report: RollingDataHealthCloseReport | null,
): RollingDataHealthCloseSummary | null {
  if (!report) return null
  return {
    generatedAt: report.generatedAt,
    startDate: report.startDate,
    endDate: report.endDate,
    rangeLabel: report.dataRangeLabel,
    gmvAmountYuan: report.gmvAmountYuan,
    actualSignedAmountYuan: report.actualSignedAmountYuan,
    refundAmountYuan: report.refundAmountYuan,
    paidOrderCount: report.paidOrderCount,
    signedOrderCount: report.signedOrderCount,
    refundOrderCount: report.refundOrderCount,
    signRate: report.signRate,
    refundRate: report.refundRate,
    qualityRefundOrderCount: report.qualityRefundOrderCount,
    qualityRefundRate: report.qualityRefundRate,
    afterSaleRecordCount: report.afterSaleRecordCount,
    afterSaleRelatedOrderCount: report.afterSaleRelatedOrderCount ?? 0,
    afterSaleSignalRecordCount: report.afterSaleSignalRecordCount ?? report.afterSaleRecordCount,
    afterSaleCacheRecordCount: report.afterSaleCacheRecordCount,
    afterSaleCacheRecordScope: report.afterSaleCacheRecordScope,
    unassignedOrderCount: report.unassignedOrderCount,
    duplicateOrderCount: report.duplicateOrderCount,
    warnings: report.warnings,
  }
}

/** 经营看板用：业务同步状态 + 进行中任务进度（复用 sync/status 字段） */
export async function buildBoardSyncMetaForApi(): Promise<{
  businessSync: Awaited<ReturnType<typeof getBusinessSyncStatus>>['businessSync']
  buyerRankingSync: Awaited<ReturnType<typeof getBusinessSyncStatus>>['buyerRankingSync']
  cookieHealth: Awaited<ReturnType<typeof getCookieHealthPayload>> | ReturnType<typeof buildDegradedCookieHealth>
  syncRunning: boolean
  activeSyncJob: BoardActiveSyncJobView | null
  totalRawOrders: number
  totalRawLiveSessions: number
  totalAfterSaleRecords: number
  totalQualityCases: number
  buyerProfileStatus: BuyerProfileStatusView
  rollingDataHealthClose: RollingDataHealthCloseSummary | null
}> {
  const [base, syncPayload, totalRawOrders, totalRawLiveSessions, afterSaleCount, qualityCaseCount, buyerCacheRow, rollingReport] =
    await Promise.all([
      getBusinessSyncStatus(),
      getSyncStatusPayload(),
      prisma.xhsRawOrder.count(),
      prisma.xhsRawLiveSession.count(),
      prisma.xhsAfterSalesWorkbenchCache.count(),
      prisma.qualityBadCase.count(),
      prisma.buyerRankingCache.findUnique({ where: { id: 'default' } }),
      readLatestRollingDataHealthCloseReport(),
    ])

  let cookieHealth: Awaited<ReturnType<typeof getCookieHealthPayload>> | ReturnType<typeof buildDegradedCookieHealth>
  try {
    cookieHealth = await getCookieHealthPayload()
  } catch {
    cookieHealth = buildDegradedCookieHealth('Cookie 状态读取失败，但不影响本地数据查看')
  }

  const bizRunning =
    base.businessSync.status === 'running' || base.businessSync.status === 'queued'

  let rawJob: XhsSyncJobView | null = null
  if (
    bizRunning &&
    syncPayload.job?.preset === 'daily_strategy' &&
    syncPayload.job.isRunning
  ) {
    rawJob = syncPayload.job
  }

  let staleRunning = false
  if (rawJob) {
    const row = await prisma.xhsSyncJob.findUnique({ where: { id: rawJob.syncJobId } })
    if (row) {
      staleRunning = isBusinessSyncJobStale(row).stale
    }
  }

  const activeSyncJob = rawJob
    ? toActiveSyncJobView(rawJob, { afterSaleCount, qualityCaseCount }, staleRunning)
    : null

  const syncRunning = bizRunning || Boolean(activeSyncJob)

  const buyerProfileStatus = buildBuyerProfileStatusForApi(buyerCacheRow, base.buyerRankingSync)

  return {
    businessSync: base.businessSync,
    buyerRankingSync: base.buyerRankingSync,
    cookieHealth,
    syncRunning,
    activeSyncJob,
    totalRawOrders,
    totalRawLiveSessions,
    totalAfterSaleRecords: afterSaleCount,
    totalQualityCases: qualityCaseCount,
    buyerProfileStatus,
    rollingDataHealthClose: toRollingDataHealthCloseSummary(rollingReport),
  }
}
