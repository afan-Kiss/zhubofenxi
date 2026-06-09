import { Router } from 'express'
import { getClientIp } from '../middleware/audit.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import { fetchXhsOrderListTest } from '../services/xhs-test-order-list.service'
import { syncOrderListOnly } from '../services/xhs-api-sync/xhs-order-sync.service'
import { syncLiveSessionListOnly } from '../services/xhs-api-sync/xhs-live-sync.service'
import {
  summarizeNormalizedOrders,
  summarizeNormalizedLiveSessions,
  summarizeNormalizedSettlements,
} from '../services/xhs-api-sync/xhs-json-normalizer.service'
import {
  syncPendingSettlementListOnly,
  syncSettledSettlementListOnly,
} from '../services/xhs-api-sync/xhs-settlement-sync.service'
import { sendFail, sendOk } from '../utils/response'

export const xhsTestRouter = Router()

function auditCtx(req: import('express').Request) {
  return {
    userId: req.user!.id,
    username: req.user!.username,
    role: req.user!.role,
    requestId: req.requestId,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] ?? undefined,
  }
}

xhsTestRouter.post(
  '/order-list',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    try {
      const result = await fetchXhsOrderListTest(auditCtx(req))
      sendOk(res, result)
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '订单列表测试失败', 500)
    }
  },
)

xhsTestRouter.post(
  '/order-list-pages',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    const startDate = String(req.body?.startDate ?? '').trim()
    const endDate = String(req.body?.endDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 和 endDate（YYYY-MM-DD）')
      return
    }
    try {
      const result = await syncOrderListOnly({
        startDate,
        endDate,
        saveToDb: false,
        context: auditCtx(req),
      })
      sendOk(res, {
        total: result.total,
        itemCount: result.itemCount,
        pageCount: result.pageCount,
        firstOrderId: result.firstOrderId,
        firstPackageId: result.firstPackageId,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '订单列表分页测试失败', 500)
    }
  },
)

xhsTestRouter.post(
  '/order-list-save',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    const startDate = String(req.body?.startDate ?? '').trim()
    const endDate = String(req.body?.endDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 和 endDate（YYYY-MM-DD）')
      return
    }
    try {
      const result = await syncOrderListOnly({
        startDate,
        endDate,
        saveToDb: true,
        context: auditCtx(req),
      })
      sendOk(res, {
        total: result.total,
        savedCount: result.savedCount ?? 0,
        pageCount: result.pageCount,
        itemCount: result.itemCount,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '订单列表保存失败', 500)
    }
  },
)

xhsTestRouter.get(
  '/normalized-orders',
  requireAuth,
  requireRole('super_admin'),
  async (_req, res) => {
    try {
      const summary = await summarizeNormalizedOrders()
      sendOk(res, {
        totalRaw: summary.totalRaw,
        normalizedCount: summary.normalizedCount,
        abnormalCount: summary.abnormalCount,
        gmvCent: summary.gmvCent,
        orderCount: summary.orderCount,
        sample: summary.sample
          ? {
              orderId: summary.sample.orderId,
              orderTimeText: summary.sample.orderTimeText,
              gmvCent: summary.sample.gmvCent,
              orderStatusText: summary.sample.orderStatusText,
              isReturned: summary.sample.isReturned,
            }
          : null,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '标准化订单失败', 500)
    }
  },
)

xhsTestRouter.post(
  '/live-session-list-pages',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    const startDate = String(req.body?.startDate ?? '').trim()
    const endDate = String(req.body?.endDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 和 endDate（YYYY-MM-DD）')
      return
    }
    try {
      const result = await syncLiveSessionListOnly({
        startDate,
        endDate,
        saveToDb: false,
        context: auditCtx(req),
      })
      sendOk(res, {
        total: result.total,
        itemCount: result.itemCount,
        pageCount: result.pageCount,
        firstLiveId: result.firstLiveId,
        firstLiveName: result.firstLiveName,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '直播场次分页测试失败', 500)
    }
  },
)

xhsTestRouter.post(
  '/live-session-list-save',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    const startDate = String(req.body?.startDate ?? '').trim()
    const endDate = String(req.body?.endDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 和 endDate（YYYY-MM-DD）')
      return
    }
    try {
      const result = await syncLiveSessionListOnly({
        startDate,
        endDate,
        saveToDb: true,
        context: auditCtx(req),
      })
      sendOk(res, {
        total: result.total,
        savedCount: result.savedCount ?? 0,
        pageCount: result.pageCount,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '直播场次保存失败', 500)
    }
  },
)

xhsTestRouter.get(
  '/normalized-live-sessions',
  requireAuth,
  requireRole('super_admin'),
  async (_req, res) => {
    try {
      const summary = await summarizeNormalizedLiveSessions()
      sendOk(res, {
        totalRaw: summary.totalRaw,
        normalizedCount: summary.normalizedCount,
        abnormalCount: summary.abnormalCount,
        totalLiveGmvCent: summary.totalLiveGmvCent,
        totalRefundCent: summary.totalRefundCent,
        totalDurationMinutes: summary.totalDurationMinutes,
        sample: summary.sample.map((s) => ({
          liveId: s.liveId,
          liveName: s.liveName,
          anchorName: s.anchorName,
          durationMinutes: s.durationMinutes,
          liveGmvCent: s.liveGmvCent,
          refundAmountCent: s.refundAmountCent,
        })),
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '标准化直播场次失败', 500)
    }
  },
)

xhsTestRouter.post(
  '/pending-settlement-list-pages',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    const startDate = String(req.body?.startDate ?? '').trim()
    const endDate = String(req.body?.endDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 和 endDate（YYYY-MM-DD）')
      return
    }
    try {
      const result = await syncPendingSettlementListOnly({
        startDate,
        endDate,
        saveToDb: false,
        context: auditCtx(req),
      })
      sendOk(res, {
        total: result.total,
        itemCount: result.itemCount,
        pageCount: result.pageCount,
        firstSettleNo: result.firstSettleNo,
        firstPackageId: result.firstPackageId,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '待结算列表测试失败', 500)
    }
  },
)

xhsTestRouter.post(
  '/pending-settlement-list-save',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    const startDate = String(req.body?.startDate ?? '').trim()
    const endDate = String(req.body?.endDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 和 endDate（YYYY-MM-DD）')
      return
    }
    try {
      const result = await syncPendingSettlementListOnly({
        startDate,
        endDate,
        saveToDb: true,
        context: auditCtx(req),
      })
      sendOk(res, {
        total: result.total,
        savedCount: result.savedCount ?? 0,
        pageCount: result.pageCount,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '待结算保存失败', 500)
    }
  },
)

xhsTestRouter.post(
  '/settled-settlement-list-pages',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    const startDate = String(req.body?.startDate ?? '').trim()
    const endDate = String(req.body?.endDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 和 endDate（YYYY-MM-DD）')
      return
    }
    try {
      const result = await syncSettledSettlementListOnly({
        startDate,
        endDate,
        saveToDb: false,
        context: auditCtx(req),
      })
      sendOk(res, {
        total: result.total,
        itemCount: result.itemCount,
        pageCount: result.pageCount,
        firstSettleNo: result.firstSettleNo,
        firstPackageId: result.firstPackageId,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '已结算列表测试失败', 500)
    }
  },
)

xhsTestRouter.post(
  '/settled-settlement-list-save',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    const startDate = String(req.body?.startDate ?? '').trim()
    const endDate = String(req.body?.endDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 和 endDate（YYYY-MM-DD）')
      return
    }
    try {
      const result = await syncSettledSettlementListOnly({
        startDate,
        endDate,
        saveToDb: true,
        context: auditCtx(req),
      })
      sendOk(res, {
        total: result.total,
        savedCount: result.savedCount ?? 0,
        pageCount: result.pageCount,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '已结算保存失败', 500)
    }
  },
)

xhsTestRouter.get(
  '/normalized-settlements',
  requireAuth,
  requireRole('super_admin'),
  async (_req, res) => {
    try {
      const summary = await summarizeNormalizedSettlements()
      sendOk(res, summary)
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '标准化结算失败', 500)
    }
  },
)
