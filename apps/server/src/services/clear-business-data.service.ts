import { prisma } from '../lib/prisma'
import { writeOperationLog } from './audit.service'
import { invalidateAndRebuildBusinessBoardCache } from './business-cache.service'
import { invalidateQualityBadCaseMemoryCache } from './quality-badcase-store.service'

/** 系统设置清空确认：输入「清空」即可 */
export const CLEAR_BUSINESS_DATA_PHRASE = '清空'

export async function clearBusinessDataForSettings(params: {
  confirmPhrase: string
  userId: string
  username: string
  role: string
  audit?: { requestId?: string; ip?: string; userAgent?: string }
}): Promise<{
  ok: true
  cleared: Record<string, number>
  preserved: { liveAccounts: number; cookies: number }
  syncTriggered: boolean
}> {
  if (params.confirmPhrase.trim() !== CLEAR_BUSINESS_DATA_PHRASE) {
    throw new Error(`请输入「${CLEAR_BUSINESS_DATA_PHRASE}」以确认操作`)
  }

  const running = await prisma.xhsSyncJob.findFirst({ where: { status: 'running' } })
  if (running) {
    throw new Error('当前有同步任务进行中，请等待完成后再清空业务数据')
  }

  const cleared: Record<string, number> = {}

  await prisma.$transaction(async (tx) => {
    cleared.xhsRawOrderDetail = (await tx.xhsRawOrderDetail.deleteMany()).count
    cleared.xhsRawLiveSessionDetail = (await tx.xhsRawLiveSessionDetail.deleteMany()).count
    cleared.xhsRawOrder = (await tx.xhsRawOrder.deleteMany()).count
    cleared.xhsRawLiveSession = (await tx.xhsRawLiveSession.deleteMany()).count
    cleared.xhsRawPendingSettlement = (await tx.xhsRawPendingSettlement.deleteMany()).count
    cleared.xhsRawSettledSettlement = (await tx.xhsRawSettledSettlement.deleteMany()).count
    cleared.xhsAfterSalesWorkbenchCache = (await tx.xhsAfterSalesWorkbenchCache.deleteMany()).count
    cleared.xhsAfterSalesWorkbenchQueue = (await tx.xhsAfterSalesWorkbenchQueue.deleteMany()).count
    cleared.xhsAfterSalesTimeSearchCache = (await tx.xhsAfterSalesTimeSearchCache.deleteMany()).count
    cleared.qualityBadCase = (await tx.qualityBadCase.deleteMany()).count
    cleared.qualityBadCaseSyncMeta = (await tx.qualityBadCaseSyncMeta.deleteMany()).count
    cleared.buyerRankingCache = (await tx.buyerRankingCache.deleteMany()).count
    cleared.refreshJob = (await tx.refreshJob.deleteMany()).count
    cleared.xhsSyncJob = (await tx.xhsSyncJob.deleteMany()).count
    cleared.orderTrackingPool = (await tx.orderTrackingPool.deleteMany()).count
    cleared.historicalAdjustment = (await tx.historicalAdjustment.deleteMany()).count
    cleared.monthlyDataStatus = (await tx.monthlyDataStatus.deleteMany()).count
    cleared.validationPackage = (await tx.validationPackage.deleteMany()).count
    cleared.reportExport = (await tx.reportExport.deleteMany()).count
    cleared.downloadTask = (await tx.downloadTask.deleteMany()).count
    cleared.downloadBatch = (await tx.downloadBatch.deleteMany()).count
  })

  await invalidateAndRebuildBusinessBoardCache('清空业务数据')
  invalidateQualityBadCaseMemoryCache()

  const liveAccounts = await prisma.platformCredential.count()
  const cookies = await prisma.platformCredential.count({
    where: { NOT: { cookieEncrypted: '' } },
  })

  await writeOperationLog({
    userId: params.userId,
    username: params.username,
    role: params.role,
    action: 'data_clear_all',
    module: 'settings',
    description: `${params.username} 清空全部业务数据（保留直播号 Cookie）`,
    requestId: params.audit?.requestId ?? null,
    ip: params.audit?.ip ?? null,
    userAgent: params.audit?.userAgent ?? null,
    meta: { cleared, preserved: { liveAccounts, cookies } },
  })

  const { triggerBusinessSyncIfStale } = await import('./business-sync-scheduler.service')
  const syncResult = await triggerBusinessSyncIfStale('catchup')

  return {
    ok: true,
    syncTriggered: syncResult === 'started' || syncResult === 'queued',
    cleared: {
      orders: cleared.xhsRawOrder ?? 0,
      liveSessions: cleared.xhsRawLiveSession ?? 0,
      afterSales:
        (cleared.xhsAfterSalesWorkbenchCache ?? 0) +
        (cleared.xhsAfterSalesTimeSearchCache ?? 0) +
        (cleared.xhsAfterSalesWorkbenchQueue ?? 0),
      qualityCases: cleared.qualityBadCase ?? 0,
      businessCache: 1,
      buyerRankingCache: cleared.buyerRankingCache ?? 0,
      syncJobs: cleared.xhsSyncJob ?? 0,
      ...cleared,
    },
    preserved: { liveAccounts, cookies },
  }
}
