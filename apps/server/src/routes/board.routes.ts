import { Router } from 'express'
import { attachLocalViewer } from '../middleware/local-viewer.middleware'
import { requireMaintenanceTools } from '../middleware/maintenance.middleware'
import { getClientIp } from '../middleware/audit.middleware'
import { sendFail, sendOk } from '../utils/response'
import {
  buildBoardMetricDetail,
  buildBuyerSummaryDrill,
  type BoardMetricKey,
} from '../services/board-metric-detail.service'
import {
  buildAnchorDrill,
  buildBuyerProfileDrill,
  syncBuyerProfileAfterSales,
} from '../services/board-drill.service'
import {
  getBuyerRankingProfile,
  rebuildBuyerRankingCache,
  isBuyerRankingCacheRebuilding,
  scheduleBuyerRankingCacheRebuild,
  buildBuyerProfileStatusForApi,
  BUYER_RANKING_CACHE_VERSION,
} from '../services/buyer-ranking-cache.service'
import { prisma } from '../lib/prisma'
import { loadAllQualityBadCases } from '../services/quality-badcase-store.service'
import { buildHighValueCustomerDefinition } from '../services/buyer-ranking-classification'
import { executeBoardLocalQuery } from '../services/board-local-query.service'
import { getBusinessSyncStatus } from '../services/business-sync-scheduler.service'
import { validateSyncRangeInput } from '../utils/sync-range-validation'
import { logInfo } from '../utils/server-log'

export const boardRouter = Router()

const auditCtx = (req: import('express').Request) => ({
  requestId: req.requestId,
  ip: getClientIp(req),
  userAgent: req.headers['user-agent'] ?? undefined,
})

boardRouter.use(attachLocalViewer)

boardRouter.get('/local-data', async (req, res) => {
  try {
    const preset = String(req.query.preset ?? 'thisMonth')
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined
    const data = await executeBoardLocalQuery({
      preset: preset as import('../services/board-live-query.service').BoardLiveQueryPreset,
      startDate,
      endDate,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载本地经营数据失败', 500)
  }
})

boardRouter.get('/sync-meta', async (_req, res) => {
  try {
    const { buildBoardSyncMetaForApi } = await import('../services/board-sync-meta.service')
    sendOk(res, await buildBoardSyncMetaForApi())
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取同步状态失败', 500)
  }
})

boardRouter.get('/sync-debug', async (_req, res) => {
  try {
    const { buildBoardSyncDebugForApi } = await import('../services/board-sync-debug.service')
    sendOk(res, await buildBoardSyncDebugForApi())
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '同步调试信息失败', 500)
  }
})

boardRouter.get('/sync-diagnose', requireMaintenanceTools, async (req, res) => {
  try {
    const { buildBoardSyncDiagnose } = await import('../services/board-sync-diagnose.service')
    const data = await buildBoardSyncDiagnose({
      preset: req.query.preset ? String(req.query.preset) : 'thisMonth',
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '同步诊断失败', 500)
  }
})

boardRouter.get('/metric-detail', async (req, res) => {
  try {
    const metric = String(req.query.metric ?? '') as BoardMetricKey
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    const data = await buildBoardMetricDetail({
      metric,
      preset: req.query.preset ? String(req.query.preset) : undefined,
      startDate,
      endDate,
      anchorId: req.query.anchorId ? String(req.query.anchorId) : undefined,
      anchorName: req.query.anchorName ? String(req.query.anchorName) : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      tab: req.query.tab ? String(req.query.tab) : undefined,
      sort: req.query.sort ? String(req.query.sort) : undefined,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取指标明细失败', 500)
  }
})

boardRouter.get('/export-all-synced-check/meta', async (_req, res) => {
  try {
    const { buildBoardAllSyncedCheckExportMeta } = await import(
      '../services/board-all-synced-check-export.service'
    )
    sendOk(res, await buildBoardAllSyncedCheckExportMeta())
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取导出元数据失败', 500)
  }
})

boardRouter.post('/export-all-synced-check', async (req, res) => {
  try {
    const { buildBoardAllSyncedCheckExportBuffer } = await import(
      '../services/board-all-synced-check-export.service'
    )
    const { buffer, filename } = await buildBoardAllSyncedCheckExportBuffer({
      username: req.user!.username,
    })
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    )
    res.send(buffer)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '导出核对包失败'
    sendFail(res, msg, /无已同步|请先/.test(msg) ? 400 : 500)
  }
})

/** @deprecated 请使用 POST /api/board/export-all-synced-check */
boardRouter.post('/export-reconciliation', async (_req, res) => {
  sendFail(
    res,
    '该导出接口已废弃，请使用「导出全部已同步数据核对包」（POST /api/board/export-all-synced-check）',
    410,
  )
})

boardRouter.get('/anchor-drill', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    const data = await buildAnchorDrill({
      preset: req.query.preset ? String(req.query.preset) : 'custom',
      anchorId: req.query.anchorId ? String(req.query.anchorId) : undefined,
      anchorName: req.query.anchorName ? String(req.query.anchorName) : undefined,
      startDate,
      endDate,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      sort: req.query.sort ? String(req.query.sort) : undefined,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取主播下钻失败', 500)
  }
})

boardRouter.get('/buyer-profile', async (req, res) => {
  try {
    const { buildQualityFeedbackPublicStatus } =
      await import('../services/quality-badcase-auto-sync.service')
    const qualityFeedback = await buildQualityFeedbackPublicStatus()
    const rawProfile = await getBuyerRankingProfile()
    const { filterBuyerProfileForStaff } = await import('../services/board.service')
    const { buildPaginatedBuyerProfileResponse } = await import(
      '../services/buyer-profile-api.service'
    )
    const filtered = await filterBuyerProfileForStaff(
      rawProfile,
      req.user!.role as import('../types/roles').UserRole,
      req.user!.username,
    )
    const page = req.query.page ? Number(req.query.page) : 1
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20
    const rankingTab = req.query.rankingTab ? String(req.query.rankingTab) : 'spend'

    if (!filtered) {
      sendOk(res, {
        source: 'buyer_profile_cache',
        cacheVersion: null,
        expectedCacheVersion: BUYER_RANKING_CACHE_VERSION,
        cacheCompatible: false,
        items: [],
        summary: {
          highValueCount: 0,
          repurchaseCount: 0,
          refundCount: 0,
          qualityHeavyCount: 0,
          blacklistCount: 0,
        },
        blacklistedBuyerIds: [],
        updatedAt: null,
        builtAt: null,
        orderCount: 0,
        buyerCount: 0,
        lastTrigger: null,
        rebuilding: isBuyerRankingCacheRebuilding(),
        sampleMeta: null,
        highValueCustomerDefinition: buildHighValueCustomerDefinition(),
        qualityFeedback,
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1, rankingTab },
      })
      return
    }
    const data = buildPaginatedBuyerProfileResponse(filtered, { page, pageSize, rankingTab })
    sendOk(res, { ...data, rebuilding: isBuyerRankingCacheRebuilding(), qualityFeedback })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取买家画像失败', 500)
  }
})

boardRouter.post('/buyer-profile/auto-rebuild', async (_req, res) => {
  try {
    const profile = await getBuyerRankingProfile()
    const needsRebuild =
      Boolean(profile?.cacheStale) ||
      profile?.cacheCompatible === false ||
      isBuyerRankingCacheRebuilding()
    const scheduled = needsRebuild
      ? scheduleBuyerRankingCacheRebuild('page_auto_rebuild')
      : false
    const buyerCacheRow = await prisma.buyerRankingCache.findUnique({ where: { id: 'default' } })
    const syncBase = await getBusinessSyncStatus()
    const status = buildBuyerProfileStatusForApi(buyerCacheRow, syncBase.buyerRankingSync)
    sendOk(res, {
      scheduled,
      rebuilding: isBuyerRankingCacheRebuilding(),
      cacheVersion: profile?.cacheVersion ?? status.cacheVersion,
      expectedCacheVersion: BUYER_RANKING_CACHE_VERSION,
      cacheCompatible: profile?.cacheCompatible ?? status.cacheCompatible,
      status,
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '触发买家画像重建失败', 500)
  }
})

boardRouter.post('/buyer-profile/refresh', requireMaintenanceTools, async (req, res) => {
  const user = req.user!
  const started = Date.now()
  logInfo('买家排行', `用户 ${user.username} 手动触发排行缓存重建`)

  try {
    const before = await getBuyerRankingProfile()
    const beforeVersion = before?.cacheVersion ?? 'none'
    const result = await rebuildBuyerRankingCache(
      user.username ? `page_refresh:${user.username}` : 'page_refresh',
    )
    const profile = await getBuyerRankingProfile()
    const afterVersion = profile?.cacheVersion ?? BUYER_RANKING_CACHE_VERSION
    const durationMs = Date.now() - started

    logInfo(
      '买家排行',
      `重建完成：${profile?.sampleMeta?.sampleCustomerCount ?? result.buyerCount} 位买家，` +
        `${profile?.sampleMeta?.sampleOrderCount ?? result.orderCount} 单，用时 ${durationMs}ms`,
    )

    sendOk(res, {
      rebuilt: true,
      lastUpdatedAt: profile?.updatedAt ?? result.updatedAt,
      sampleOrderCount: profile?.sampleMeta?.sampleOrderCount ?? result.orderCount,
      sampleCustomerCount: profile?.sampleMeta?.sampleCustomerCount ?? result.buyerCount,
      sampleStartTime: profile?.sampleMeta?.sampleStartTime ?? null,
      sampleEndTime: profile?.sampleMeta?.sampleEndTime ?? null,
      sampleTimeField: 'payTime' as const,
      summary: {
        highValueCustomerCount: profile?.summary.highValueCount ?? 0,
        repeatCustomerCount: profile?.summary.repurchaseCount ?? 0,
        afterSaleRiskCustomerCount: profile?.summary.refundCount ?? 0,
        qualityIssueCustomerCount: profile?.summary.qualityHeavyCount ?? 0,
      },
      cacheVersion: afterVersion,
      profile,
      buyerCount: result.buyerCount,
      orderCount: result.orderCount,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '更新买家排行失败'
    console.warn(
      `[buyer-ranking] refresh failed user=${user.username} role=${user.role}: ${msg}`,
    )
    sendFail(res, msg, /正在更新|无订单/.test(msg) ? 400 : 500)
  }
})

boardRouter.get('/buyer-profile/:buyerKey/orders', async (req, res) => {
  try {
    const buyerKey = String(req.params.buyerKey ?? '').trim()
    if (!buyerKey) {
      sendFail(res, '请提供 buyerKey', 400)
      return
    }
    const data = await buildBuyerProfileDrill({
      buyerId: buyerKey,
      buyerKey,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      sort: req.query.sort ? String(req.query.sort) : undefined,
      tab: req.query.tab ? String(req.query.tab) : undefined,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, {
      buyerKey: data.buyerKey,
      buyerId: data.buyerId,
      nickname: data.nickname,
      buyerDisplayName: data.buyerDisplayName,
      buyerDisplayLabel: data.buyerDisplayLabel,
      buyerShortCode: data.buyerShortCode,
      buyerIdentityCode: data.buyerIdentityCode,
      identitySource: data.identitySource,
      summary: data.buyerSummary,
      tabs: data.tabs,
      currentFilterSummary: data.currentFilterSummary,
      pagination: data.pagination,
      rows: data.rows,
      emptyText: data.emptyText,
      source: data.source,
      profileUpdatedAt: data.profileUpdatedAt,
      needAfterSalesSync: data.needAfterSalesSync,
      pendingAfterSalesOrderNos: data.pendingAfterSalesOrderNos,
      blacklistedBuyerIds: data.blacklistedBuyerIds,
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取买家订单失败', 500)
  }
})

boardRouter.get('/buyer-profile-drill', async (req, res) => {
  try {
    const buyerKey = req.query.buyerKey
      ? String(req.query.buyerKey)
      : req.query.buyerId
        ? String(req.query.buyerId)
        : ''
    if (!buyerKey) {
      sendFail(res, '请提供 buyerKey', 400)
      return
    }
    const data = await buildBuyerProfileDrill({
      buyerId: buyerKey,
      buyerKey,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      sort: req.query.sort ? String(req.query.sort) : undefined,
      tab: req.query.tab ? String(req.query.tab) : undefined,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取买家明细失败', 500)
  }
})

boardRouter.post('/buyer-profile-drill/sync-after-sales', requireMaintenanceTools, async (req, res) => {
  try {
    const buyerKey = String(req.body?.buyerKey ?? req.body?.buyerId ?? '').trim()
    if (!buyerKey) {
      sendFail(res, '请提供 buyerKey', 400)
      return
    }
    const orderNos = Array.isArray(req.body?.orderNos)
      ? (req.body.orderNos as unknown[]).map((n) => String(n).trim()).filter(Boolean)
      : undefined
    const data = await syncBuyerProfileAfterSales({ buyerKey, orderNos })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '同步售后金额失败', 500)
  }
})

boardRouter.get('/buyer-ranking/summary-drill', async (req, res) => {
  try {
    const summaryKeyRaw = String(req.query.summaryKey ?? '').trim()
    if (!summaryKeyRaw || summaryKeyRaw === 'blacklist') {
      sendFail(res, '请提供 summaryKey', 400)
      return
    }
    const summaryKey = summaryKeyRaw as
      | 'highValue'
      | 'repurchase'
      | 'refund'
      | 'qualityHeavy'
    const data = await buildBuyerSummaryDrill({
      summaryKey,
      preset: req.query.preset ? String(req.query.preset) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      sort: req.query.sort ? String(req.query.sort) : undefined,
      anchorName: req.query.anchorName ? String(req.query.anchorName) : undefined,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取买家汇总明细失败', 500)
  }
})
