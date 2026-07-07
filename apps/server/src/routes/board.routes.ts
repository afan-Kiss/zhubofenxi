import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
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
  buildAnchorQualityRefundDrill,
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
import { buildAnchorPocketSummary } from '../services/anchor-pocket-revenue.service'
import { recalculateAnchorDataForDate } from '../services/anchor-schedule-cache.service'

export const boardRouter = Router()

const auditCtx = (req: import('express').Request) => ({
  requestId: req.requestId,
  ip: getClientIp(req),
  userAgent: req.headers['user-agent'] ?? undefined,
})

boardRouter.use(attachRequestUser, requireAuth)

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

boardRouter.get('/data-freshness', async (req, res) => {
  try {
    const startDate = String(req.query.startDate ?? '').trim()
    const endDate = String(req.query.endDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    const { getDataFreshness } = await import('../services/data-freshness.service')
    sendOk(res, await getDataFreshness(startDate, endDate))
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '读取数据更新时间失败', 500)
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

boardRouter.post('/data-health/rolling-close/run', async (_req, res) => {
  try {
    const { runRollingDataHealthClose } = await import('../services/rolling-data-health-close.service')
    const report = await runRollingDataHealthClose({ triggeredBy: 'manual-api' })
    sendOk(res, { ok: true, report })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '滚动30天数据健康结账失败', 500)
  }
})

boardRouter.get('/data-health/rolling-close/latest', async (_req, res) => {
  try {
    const { readLatestRollingDataHealthCloseReport } = await import(
      '../services/rolling-data-health-close-store.service'
    )
    sendOk(res, await readLatestRollingDataHealthCloseReport())
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '读取滚动30天结账报告失败', 500)
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
      overviewStableSnapshot:
        req.query.overviewStableSnapshot === 'true' ||
        req.query.overviewStableSnapshot === '1',
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

boardRouter.get('/anchor-pocket-summary', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    const data = await buildAnchorPocketSummary({
      preset: req.query.preset ? String(req.query.preset) : 'custom',
      startDate,
      endDate,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取主播实际到账失败', 500)
  }
})

boardRouter.post('/anchor-pocket-summary/recalculate', async (req, res) => {
  try {
    const date = String(req.body?.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date', 400)
      return
    }
    await recalculateAnchorDataForDate(date)
    sendOk(res, { ok: true, date, message: '已刷新该日期的主播归属缓存' })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '重算失败', 500)
  }
})

boardRouter.post('/order-anchor-manual-assign', async (req, res) => {
  try {
    const orderNo = String(req.body?.orderNo ?? req.body?.orderKey ?? '').trim()
    const anchorName = String(req.body?.anchorName ?? '').trim()
    if (!orderNo || !anchorName) {
      sendFail(res, '请提供 orderNo 与 anchorName', 400)
      return
    }
    const { assignOrderAnchorManualOverride } = await import(
      '../services/order-anchor-manual-override.service'
    )
    const result = await assignOrderAnchorManualOverride({
      orderKey: orderNo,
      anchorName,
      assignedBy: req.user!.username,
    })
    sendOk(res, { ok: true, ...result })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '指定主播失败', 500)
  }
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
      statusType: req.query.statusType ? String(req.query.statusType) : 'signed',
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取主播下钻失败', 500)
  }
})

boardRouter.get('/anchor-quality-refund-drill', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    const data = await buildAnchorQualityRefundDrill({
      preset: req.query.preset ? String(req.query.preset) : 'custom',
      anchorId: req.query.anchorId ? String(req.query.anchorId) : undefined,
      anchorName: req.query.anchorName ? String(req.query.anchorName) : undefined,
      startDate,
      endDate,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取品退明细失败', 500)
  }
})

boardRouter.get('/daily-report', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    if (startDate !== endDate) {
      sendFail(res, '日报仅支持单日范围', 400)
      return
    }
    const { buildDailyReport } = await import('../services/daily-report.service')
    const queryPreset = req.query.preset ? String(req.query.preset) : 'custom'
    const data = await buildDailyReport({
      preset: queryPreset,
      startDate,
      endDate,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载日报失败', 500)
  }
})

boardRouter.get('/daily-report/debug-live-sessions', async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date).trim() : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      sendFail(res, '请提供 date=YYYY-MM-DD', 400)
      return
    }
    const { resolveDailyReportLiveSessionAssignments } = await import(
      '../services/daily-report-live-sessions.service'
    )
    const assignment = await resolveDailyReportLiveSessionAssignments(date)
    const byAnchor = Object.fromEntries(
      [...assignment.byAnchor.entries()].map(([anchorName, sessions]) => [
        anchorName,
        {
          sessionCount: sessions.length,
          liveDurationMinutes: sessions.reduce((sum, s) => sum + s.durationMinutes, 0),
          liveTimeRanges: sessions.map((s) => ({
            liveId: s.liveId,
            shop: s.sourceShopName,
            start: s.startTime,
            end: s.endTime,
          })),
        },
      ]),
    )
    sendOk(res, {
      dateKey: assignment.dateKey,
      effectiveSchedules: assignment.effectiveSchedules,
      rawSessions: assignment.allSessions.map((s) => ({
        sourceShopCode: s.sourceShopCode,
        sourceShopName: s.sourceShopName,
        liveId: s.liveId,
        liveAccountName: s.liveAccountName,
        actualStartAt: s.startTime,
        actualEndAt: s.endTime,
        durationMinutes: s.durationMinutes,
      })),
      assignedSessions: assignment.assignedSessions.map((s) => s.liveId),
      unassignedSessions: assignment.unassignedSessions.map((s) => ({
        liveId: s.liveId,
        shop: s.sourceShopName,
        start: s.startTime,
        end: s.endTime,
        skipReason:
          assignment.debugRows.find((d) => d.liveId === s.liveId)?.skipReason ?? '未匹配排班',
      })),
      debugRows: assignment.debugRows,
      byAnchor,
      assignedLiveDurationMinutes: assignment.assignedLiveDurationMinutes,
      unassignedLiveDurationMinutes: assignment.unassignedLiveDurationMinutes,
      unassignedLiveSessionCount: assignment.unassignedLiveSessionCount,
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '调试直播场次失败', 500)
  }
})

boardRouter.get('/operations-report/daily', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    if (startDate !== endDate) {
      sendFail(res, '运营日报仅支持单日范围', 400)
      return
    }
    const preset = req.query.preset ? String(req.query.preset) : 'custom'
    const { buildDailyOperationsReport } = await import(
      '../services/daily-operations-report.service'
    )
    const { getOrBuildOperationsReportCache, resolveRequestCacheIdentity } = await import(
      '../services/operations-report-cache.service'
    )
    const viewer = resolveRequestCacheIdentity(req.user)
    const result = await getOrBuildOperationsReportCache(
      {
        kind: 'daily',
        startDate,
        endDate,
        preset,
        scope: 'daily',
        ...viewer,
      },
      () =>
        buildDailyOperationsReport({
          preset,
          startDate,
          endDate,
          ...viewer,
        }),
    )
    sendOk(res, {
      ...result.payload,
      cacheMeta: result.cache,
      ...(result.warning ? { cacheWarning: result.warning } : {}),
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载运营日报失败', 500)
  }
})

boardRouter.get('/operations-rankings', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      sendFail(res, 'startDate 与 endDate 格式应为 YYYY-MM-DD', 400)
      return
    }
    const rawLimit = req.query.limit ? Number(req.query.limit) : 10
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.round(rawLimit), 1), 50)
      : 10
    const preset = req.query.preset ? String(req.query.preset) : 'custom'
    const scope = req.query.scope
      ? (String(req.query.scope) as 'daily' | 'weekly' | 'custom')
      : 'custom'
    const { getOperationsRankings } = await import('../services/operations-rankings.service')
    const { getOrBuildOperationsReportCache, resolveRequestCacheIdentity } = await import(
      '../services/operations-report-cache.service'
    )
    const viewer = resolveRequestCacheIdentity(req.user)
    const result = await getOrBuildOperationsReportCache(
      {
        kind: 'rankings',
        startDate,
        endDate,
        preset,
        scope,
        limit,
        ...viewer,
      },
      () =>
        getOperationsRankings({
          startDate,
          endDate,
          preset,
          scope,
          limit,
          ...viewer,
        }),
    )
    sendOk(res, {
      ...result.payload,
      cacheMeta: result.cache,
      ...(result.warning ? { cacheWarning: result.warning } : {}),
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载榜单中心失败', 500)
  }
})

boardRouter.get('/operations-business-insight-actions', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    const scope = req.query.scope ? String(req.query.scope) : ''
    if (!startDate || !endDate || !scope) {
      sendFail(res, '请提供 startDate、endDate 与 scope', 400)
      return
    }
    const { listBusinessInsightActions } = await import(
      '../services/operations-business-insight-action.service'
    )
    const actions = await listBusinessInsightActions({ startDate, endDate, scope })
    sendOk(res, { actions })
  } catch (err) {
    const mod = await import('../services/operations-business-insight-action.service')
    if (err instanceof mod.BusinessInsightActionValidationError) {
      sendFail(res, err.message, 400)
      return
    }
    sendFail(res, err instanceof Error ? err.message : '加载经营建议处理状态失败', 500)
  }
})

boardRouter.post('/operations-business-insight-actions', async (req, res) => {
  try {
    const body = req.body as Record<string, unknown> | undefined
    const {
      upsertBusinessInsightAction,
      BusinessInsightActionValidationError,
    } = await import('../services/operations-business-insight-action.service')
    const action = await upsertBusinessInsightAction({
      insightId: body?.insightId ? String(body.insightId) : '',
      insightType: body?.insightType ? String(body.insightType) : '',
      entityType: body?.entityType ? String(body.entityType) : '',
      entityId: body?.entityId != null ? String(body.entityId) : undefined,
      entityName: body?.entityName ? String(body.entityName) : '',
      rangeStartDate: body?.rangeStartDate ? String(body.rangeStartDate) : '',
      rangeEndDate: body?.rangeEndDate ? String(body.rangeEndDate) : '',
      scope: body?.scope ? String(body.scope) : '',
      status: body?.status ? String(body.status) : 'pending',
      note: body?.note != null ? String(body.note) : undefined,
      reviewResult: body?.reviewResult != null ? String(body.reviewResult) : undefined,
      remindTomorrow: body?.remindTomorrow != null ? Boolean(body.remindTomorrow) : undefined,
    })
    const { invalidateOperationsReportCache } = await import(
      '../services/operations-report-cache.service'
    )
    invalidateOperationsReportCache('经营建议处理状态已更新')
    sendOk(res, action)
  } catch (err) {
    const mod = await import('../services/operations-business-insight-action.service')
    if (err instanceof mod.BusinessInsightActionValidationError) {
      sendFail(res, err.message, 400)
      return
    }
    sendFail(res, err instanceof Error ? err.message : '更新经营建议处理状态失败', 500)
  }
})

boardRouter.get('/operations-business-insight-action-stats', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    const scope = req.query.scope ? String(req.query.scope) : ''
    if (!startDate || !endDate || !scope) {
      sendFail(res, '请提供 startDate、endDate 与 scope', 400)
      return
    }
    const { getBusinessInsightActionStats } = await import(
      '../services/operations-business-insight-action.service'
    )
    const stats = await getBusinessInsightActionStats({ startDate, endDate, scope })
    sendOk(res, stats)
  } catch (err) {
    const mod = await import('../services/operations-business-insight-action.service')
    if (err instanceof mod.BusinessInsightActionValidationError) {
      sendFail(res, err.message, 400)
      return
    }
    sendFail(res, err instanceof Error ? err.message : '加载经营建议执行统计失败', 500)
  }
})

boardRouter.get('/operations-report/weekly', async (req, res) => {
  try {
    const weekStart = req.query.weekStart ? String(req.query.weekStart) : ''
    const weekEnd = req.query.weekEnd ? String(req.query.weekEnd) : ''
    if (!weekStart || !weekEnd) {
      sendFail(res, '请提供 weekStart 与 weekEnd', 400)
      return
    }
    const preset = req.query.preset ? String(req.query.preset) : 'custom'
    const { buildWeeklyOperationsReport } = await import(
      '../services/weekly-operations-report.service'
    )
    const { getOrBuildOperationsReportCache, resolveRequestCacheIdentity } = await import(
      '../services/operations-report-cache.service'
    )
    const viewer = resolveRequestCacheIdentity(req.user)
    const result = await getOrBuildOperationsReportCache(
      {
        kind: 'weekly',
        startDate: weekStart,
        endDate: weekEnd,
        preset,
        scope: 'weekly',
        ...viewer,
      },
      () =>
        buildWeeklyOperationsReport({
          weekStart,
          weekEnd,
          preset,
          ...viewer,
        }),
    )
    sendOk(res, {
      ...result.payload,
      cacheMeta: result.cache,
      ...(result.warning ? { cacheWarning: result.warning } : {}),
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载运营周报失败', 500)
  }
})

boardRouter.get('/operations-monthly-report', async (req, res) => {
  try {
    const month = req.query.month ? String(req.query.month) : undefined
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined
    if (!month && (!startDate || !endDate)) {
      sendFail(res, '请提供 month 或 startDate 与 endDate', 400)
      return
    }
    const preset = req.query.preset ? String(req.query.preset) : 'custom'
    const {
      getMonthlyOperationsReport,
      MonthlyOperationsReportValidationError,
    } = await import('../services/monthly-operations-report.service')
    const {
      getOrBuildOperationsReportCache,
      resolveMonthlyCacheKeyInput,
      resolveRequestCacheIdentity,
    } = await import('../services/operations-report-cache.service')
    const viewer = resolveRequestCacheIdentity(req.user)
    const cacheKeyInput = resolveMonthlyCacheKeyInput({
      month,
      startDate,
      endDate,
      preset,
      ...viewer,
    })
    const result = await getOrBuildOperationsReportCache(
      cacheKeyInput,
      () =>
        getMonthlyOperationsReport({
          month,
          startDate,
          endDate,
          preset,
          ...viewer,
        }),
    )
    sendOk(res, {
      ...result.payload,
      cacheMeta: result.cache,
      ...(result.warning ? { cacheWarning: result.warning } : {}),
    })
  } catch (err) {
    const mod = await import('../services/monthly-operations-report.service')
    if (err instanceof mod.MonthlyOperationsReportValidationError) {
      sendFail(res, err.message, 400)
      return
    }
    sendFail(res, err instanceof Error ? err.message : '加载运营月报失败', 500)
  }
})

boardRouter.get('/operations-report-cache/status', requireMaintenanceTools, async (_req, res) => {
  try {
    const { getOperationsReportCacheStatus } = await import(
      '../services/operations-report-cache.service'
    )
    sendOk(res, getOperationsReportCacheStatus())
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '读取运营报表缓存状态失败', 500)
  }
})

boardRouter.post('/operations-report-cache/prewarm', requireMaintenanceTools, async (req, res) => {
  try {
    const body = req.body as { force?: boolean } | undefined
    const { prewarmOperationsReportCache } = await import(
      '../services/operations-report-cache.service'
    )
    const result = await prewarmOperationsReportCache('手动触发', {
      forceRebuild: body?.force === true,
    })
    sendOk(res, result)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '运营报表缓存预热失败', 500)
  }
})

boardRouter.get('/operations-bi-drill', async (req, res) => {
  try {
    const {
      buildOperationsBiDrill,
      OperationsBiDrillValidationError,
    } = await import('../services/operations-bi-drill.service')
    const rawLimit = req.query.pageSize ? Number(req.query.pageSize) : 20
    const pageSize = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.round(rawLimit), 1), 100)
      : 20
    const { resolveRequestCacheIdentity } = await import(
      '../services/operations-report-cache.service'
    )
    const viewer = resolveRequestCacheIdentity(req.user)
    const data = await buildOperationsBiDrill({
      source: String(req.query.source ?? '') as import('../services/operations-bi-drill.types').OperationsBiDrillSource,
      target: String(req.query.target ?? '') as import('../services/operations-bi-drill.types').OperationsBiDrillTarget,
      startDate: req.query.startDate ? String(req.query.startDate) : '',
      endDate: req.query.endDate ? String(req.query.endDate) : '',
      preset: req.query.preset ? String(req.query.preset) : 'custom',
      scope: req.query.scope
        ? (String(req.query.scope) as 'daily' | 'weekly' | 'monthly' | 'custom')
        : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize,
      sort: req.query.sort ? String(req.query.sort) : undefined,
      ...viewer,
      anchorId: req.query.anchorId ? String(req.query.anchorId) : undefined,
      anchorName: req.query.anchorName ? String(req.query.anchorName) : undefined,
      productKey: req.query.productKey ? String(req.query.productKey) : undefined,
      productName: req.query.productName ? String(req.query.productName) : undefined,
      skuName: req.query.skuName ? String(req.query.skuName) : undefined,
      priceBandKey: req.query.priceBandKey ? String(req.query.priceBandKey) : undefined,
      priceBandLabel: req.query.priceBandLabel ? String(req.query.priceBandLabel) : undefined,
      afterSalesCategory: req.query.afterSalesCategory
        ? String(req.query.afterSalesCategory)
        : undefined,
      afterSalesReason: req.query.afterSalesReason ? String(req.query.afterSalesReason) : undefined,
      insightId: req.query.insightId ? String(req.query.insightId) : undefined,
      insightType: req.query.insightType ? String(req.query.insightType) : undefined,
      metricKey: req.query.metricKey ? String(req.query.metricKey) : undefined,
    })
    sendOk(res, data)
  } catch (err) {
    const mod = await import('../services/operations-bi-drill.service')
    if (err instanceof mod.OperationsBiDrillValidationError) {
      sendFail(res, err.message, 400)
      return
    }
    sendFail(res, err instanceof Error ? err.message : '加载数据来源失败', 500)
  }
})

boardRouter.post('/qianfan-order-detail-ticket', async (req, res) => {
  try {
    const body = req.body as { orderNo?: string } | undefined
    const {
      createQianfanOrderOpenTicket,
      QianfanOrderOpenTicketError,
    } = await import('../services/qianfan-order-open-ticket.service')
    const result = await createQianfanOrderOpenTicket(body?.orderNo ? String(body.orderNo) : '')
    sendOk(res, result)
  } catch (err) {
    const mod = await import('../services/qianfan-order-open-ticket.service')
    if (err instanceof mod.QianfanOrderOpenTicketError) {
      sendFail(res, err.message, 400)
      return
    }
    sendFail(res, err instanceof Error ? err.message : '生成订单详情入口失败', 500)
  }
})

boardRouter.get('/qianfan-order-detail/open', async (req, res) => {
  try {
    const ticket = req.query.ticket ? String(req.query.ticket) : ''
    const { consumeQianfanOrderOpenTicket } = await import(
      '../services/qianfan-order-open-ticket.service'
    )
    const result = consumeQianfanOrderOpenTicket(ticket)
    if (!result.ok) {
      res.status(410).setHeader('Content-Type', 'text/html; charset=utf-8').send(result.html)
      return
    }
    res.redirect(302, result.redirectUrl)
  } catch (err) {
    res
      .status(500)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>打开千帆订单详情</title></head><body><p>${err instanceof Error ? err.message : '打开失败'}</p></body></html>`,
      )
  }
})

boardRouter.get('/operations-report/product-detail', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    const productKey = req.query.productKey ? String(req.query.productKey) : ''
    if (!startDate || !endDate || !productKey) {
      sendFail(res, '请提供 startDate、endDate 与 productKey', 400)
      return
    }
    if (startDate !== endDate) {
      sendFail(res, '商品下钻仅支持单日范围，请按单日查询', 400)
      return
    }
    const { buildOperationsProductDetailReport } = await import(
      '../services/daily-operations-report.service'
    )
    const data = await buildOperationsProductDetailReport({
      preset: req.query.preset ? String(req.query.preset) : 'custom',
      startDate,
      endDate,
      productKey,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载商品详情失败', 500)
  }
})

boardRouter.get('/operations-report/after-sales-detail', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    if (startDate !== endDate) {
      sendFail(res, '售后下钻仅支持单日范围，请按单日查询', 400)
      return
    }
    const { buildOperationsAfterSalesDetail } = await import(
      '../services/daily-operations-report.service'
    )
    const data = await buildOperationsAfterSalesDetail({
      preset: req.query.preset ? String(req.query.preset) : 'custom',
      startDate,
      endDate,
      category: req.query.category ? String(req.query.category) : undefined,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载售后详情失败', 500)
  }
})

boardRouter.get('/operations-report/review-note', async (req, res) => {
  try {
    const reportDate = req.query.reportDate ? String(req.query.reportDate) : ''
    const reportType = req.query.reportType ? String(req.query.reportType) : 'daily'
    if (!reportDate) {
      sendFail(res, '请提供 reportDate', 400)
      return
    }
    if (reportType !== 'daily' && reportType !== 'weekly') {
      sendFail(res, 'reportType 须为 daily 或 weekly', 400)
      return
    }
    const { getOpsReviewNote } = await import('../services/ops-review-note.service')
    const data = await getOpsReviewNote({
      reportDate,
      reportType,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载复盘笔记失败', 500)
  }
})

boardRouter.put('/operations-report/review-note', async (req, res) => {
  try {
    const body = req.body as Record<string, unknown> | undefined
    const reportDate = body?.reportDate ? String(body.reportDate) : ''
    const reportType = body?.reportType ? String(body.reportType) : 'daily'
    if (!reportDate) {
      sendFail(res, '请提供 reportDate', 400)
      return
    }
    if (reportType !== 'daily' && reportType !== 'weekly') {
      sendFail(res, 'reportType 须为 daily 或 weekly', 400)
      return
    }
    const { upsertOpsReviewNote } = await import('../services/ops-review-note.service')
    const data = await upsertOpsReviewNote({
      reportDate,
      reportType: reportType as 'daily' | 'weekly',
      problemText: body?.problemText != null ? String(body.problemText) : undefined,
      reasonText: body?.reasonText != null ? String(body.reasonText) : undefined,
      trafficProducts: Array.isArray(body?.trafficProducts)
        ? body!.trafficProducts.map((v) => String(v))
        : undefined,
      mainProducts: Array.isArray(body?.mainProducts)
        ? body!.mainProducts.map((v) => String(v))
        : undefined,
      profitProducts: Array.isArray(body?.profitProducts)
        ? body!.profitProducts.map((v) => String(v))
        : undefined,
      scriptText: body?.scriptText != null ? String(body.scriptText) : undefined,
      ownerName: body?.ownerName != null ? String(body.ownerName) : undefined,
      createdBy: req.user!.username,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '保存复盘笔记失败', 500)
  }
})

boardRouter.get('/anchor-buyer-weekly-ranking', async (req, res) => {
  try {
    const { buildAnchorBuyerWeeklyRanking } = await import(
      '../services/anchor-buyer-weekly-ranking.service'
    )
    const preset = req.query.preset ? String(req.query.preset) : 'thisWeek'
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined
    const rankingTab = req.query.rankingTab ? String(req.query.rankingTab) : 'spend'
    const anchorName = req.query.anchorName ? String(req.query.anchorName) : undefined

    if (preset === 'custom' && (!startDate?.trim() || !endDate?.trim())) {
      sendFail(res, '自定义范围必须提供 startDate 与 endDate', 400)
      return
    }

    const data = await buildAnchorBuyerWeeklyRanking({
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
      preset,
      startDate,
      endDate,
      rankingTab,
      anchorName,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取主播周榜失败', 500)
  }
})

boardRouter.get('/buyer-ranking/bad-buyers', async (req, res) => {
  try {
    const { buildBadBuyerRanking } = await import('../services/bad-buyer-ranking.service')
    const preset = req.query.preset ? String(req.query.preset) : 'recent30'
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined
    const limit = req.query.limit ? Number(req.query.limit) : 10

    if (preset === 'custom' && (!startDate?.trim() || !endDate?.trim())) {
      sendFail(res, '自定义范围必须提供 startDate 与 endDate', 400)
      return
    }

    const data = await buildBadBuyerRanking({ preset, startDate, endDate, limit })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取高风险售后客户提醒失败', 500)
  }
})

boardRouter.get('/buyer-ranking/wechat-weekly-text', async (req, res) => {
  try {
    const ranking = req.query.ranking ? String(req.query.ranking) : 'highValue'
    const preset = req.query.preset ? String(req.query.preset) : ranking === 'badBuyer' ? 'recent30' : 'thisWeek'
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined
    const limit = req.query.limit ? Number(req.query.limit) : 10

    if (preset === 'custom' && (!startDate?.trim() || !endDate?.trim())) {
      sendFail(res, '自定义范围必须提供 startDate 与 endDate', 400)
      return
    }

    if (ranking === 'badBuyer') {
      const { buildBadBuyerWechatText } = await import('../services/bad-buyer-ranking.service')
      const data = await buildBadBuyerWechatText({ preset, startDate, endDate, limit })
      sendOk(res, data)
      return
    }

    const { buildWechatWeeklyBuyerRankingText } = await import(
      '../services/buyer-wechat-weekly-text.service'
    )
    const data = await buildWechatWeeklyBuyerRankingText({
      preset,
      startDate,
      endDate,
      limit,
      ranking,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '生成微信群榜单文案失败', 500)
  }
})

boardRouter.get('/buyer-value-ranking', async (req, res) => {
  try {
    const { buildBuyerValueRanking } = await import('../services/buyer-value-ranking.service')
    const preset = req.query.preset ? String(req.query.preset) : 'last90d'
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined
    const type = req.query.type ? String(req.query.type) : 'true_high_value'
    const limit = req.query.limit ? Number(req.query.limit) : 50
    const data = await buildBuyerValueRanking({ preset, startDate, endDate, type: type as never, limit })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取高价值客户榜单失败', 500)
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
    const rankingTab = req.query.rankingTab ? String(req.query.rankingTab) : 'highValue'

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
    const weeklySource = req.query.source ? String(req.query.source) : undefined
    const weeklyStart = req.query.startDate ? String(req.query.startDate) : undefined
    const weeklyEnd = req.query.endDate ? String(req.query.endDate) : undefined
    const weeklyAnchor = req.query.anchorName ? String(req.query.anchorName) : undefined
    const weeklyScope =
      weeklySource === 'anchor_weekly_ranking' && weeklyStart && weeklyEnd
        ? {
            startDate: weeklyStart,
            endDate: weeklyEnd,
            anchorName: weeklyAnchor,
            source: 'anchor_weekly_ranking' as const,
          }
        : weeklySource === 'bad_buyer_ranking' && weeklyStart && weeklyEnd
          ? {
              startDate: weeklyStart,
              endDate: weeklyEnd,
              source: 'bad_buyer_ranking' as const,
            }
          : undefined

    const data = await buildBuyerProfileDrill({
      buyerId: buyerKey,
      buyerKey,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      sort: req.query.sort ? String(req.query.sort) : undefined,
      tab: req.query.tab ? String(req.query.tab) : undefined,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
      weeklyScope,
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
      weeklyScope: data.weeklyScope,
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

boardRouter.get('/monthly-close/status', async (_req, res) => {
  try {
    const { getMonthlyCloseStatus } = await import('../services/monthly-close-auto.service')
    const data = await getMonthlyCloseStatus()
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取月度结账状态失败', 500)
  }
})

boardRouter.get('/monthly-close/report', async (req, res) => {
  try {
    const month = req.query.month ? String(req.query.month) : undefined
    const { readMonthlyCloseReport, readLatestMonthlyCloseReport } = await import(
      '../services/monthly-close-report-store.service'
    )
    const report = month ? await readMonthlyCloseReport(month) : await readLatestMonthlyCloseReport()
    if (!report) {
      sendFail(res, '暂无月度结账报告', 404)
      return
    }
    sendOk(res, report)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取月度结账报告失败', 500)
  }
})

boardRouter.post('/monthly-close/rerun', requireMaintenanceTools, async (req, res) => {
  try {
    const month = req.body?.month ? String(req.body.month) : undefined
    const { runMonthlyCloseAuto } = await import('../services/monthly-close-auto.service')
    const report = await runMonthlyCloseAuto({ month, force: true, fullScan: true })
    sendOk(res, report)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '重跑月度结账失败', 500)
  }
})

boardRouter.get('/data-accuracy-audit', async (req, res) => {
  try {
    const { runDataAccuracyAudit } = await import('../services/data-accuracy-audit.service')
    const autoPrev = req.query.autoPrevMonth === '1' || req.query.autoPrevMonth === 'true'
    let startDate = req.query.startDate ? String(req.query.startDate) : undefined
    let endDate = req.query.endDate ? String(req.query.endDate) : undefined
    if (autoPrev || (!startDate && !endDate)) {
      const { resolveMonthlyCloseMonth } = await import('../utils/monthly-close-month.util')
      const scope = resolveMonthlyCloseMonth({ autoPrevMonth: true })
      startDate = scope.startDate
      endDate = scope.endDate
    }
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    const data = await runDataAccuracyAudit({
      startDate,
      endDate,
      scope: 'custom',
      fullScan: req.query.fullScan === '1' || req.query.fullScan === 'true',
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '数据准确性总检失败', 500)
  }
})

boardRouter.get('/sync-risk/status', async (_req, res) => {
  try {
    const { buildSyncRiskStatus } = await import('../services/sync-request-audit.service')
    const data = await buildSyncRiskStatus()
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取接口风险状态失败', 500)
  }
})
