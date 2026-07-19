import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { requirePagePermission } from '../middleware/page-permission.middleware'
import { requireRole, requireSuperAdmin } from '../middleware/role.middleware'
import { sendFail, sendOk } from '../utils/response'
import { prisma } from '../lib/prisma'
import { resolveGoodReviewShopKey } from '../config/good-review-shops.constants'
import { getLuckyGiftHealthReport } from '../services/lucky-gift/lucky-gift-health.service'
import {
  getLuckyGiftSummary,
  getLuckyGiftSyncStatus,
  listLuckyGifts,
  type LuckyGiftListStatusFilter,
} from '../services/lucky-gift/lucky-gift-query.service'
import { syncLuckyGifts } from '../services/lucky-gift/lucky-gift-sync.service'
import {
  batchMarkLuckyGiftShipped,
  markLuckyGiftShipped,
} from '../services/lucky-gift/lucky-gift-shipment.service'
import {
  buildLuckyGiftAuditCopyText,
  buildLuckyGiftShipCopyText,
} from '../services/lucky-gift/lucky-gift-copy.util'
import { canViewLuckyGiftPii } from '../services/lucky-gift/lucky-gift-query.service'
import {
  createLuckyGiftQianfanOpenTicket,
  QianfanOrderOpenTicketError,
} from '../services/lucky-gift/lucky-gift-qianfan-ticket.service'

export const luckyGiftsRouter = Router()

luckyGiftsRouter.use(attachRequestUser, requireAuth, requirePagePermission('lucky_gifts'))

luckyGiftsRouter.get('/summary', async (req, res, next) => {
  try {
    const accountId = String(req.query.accountId ?? '').trim() || undefined
    const data = await getLuckyGiftSummary({ accountId })
    sendOk(res, data)
  } catch (err) {
    next(err)
  }
})

luckyGiftsRouter.get('/', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? 'todo').trim() as LuckyGiftListStatusFilter
    const data = await listLuckyGifts({
      accountId: String(req.query.accountId ?? '').trim() || undefined,
      status,
      dateRange: String(req.query.dateRange ?? '').trim() || undefined,
      startDate: String(req.query.startDate ?? '').trim() || undefined,
      endDate: String(req.query.endDate ?? '').trim() || undefined,
      keyword: String(req.query.keyword ?? '').trim() || undefined,
      anchorId: String(req.query.anchorId ?? '').trim() || undefined,
      anchorName: String(req.query.anchorName ?? '').trim() || undefined,
      page: req.query.page != null ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize != null ? Number(req.query.pageSize) : 50,
      role: req.user?.role,
    })
    sendOk(res, data)
  } catch (err) {
    next(err)
  }
})

luckyGiftsRouter.get('/sync-status', async (_req, res, next) => {
  try {
    sendOk(res, await getLuckyGiftSyncStatus())
  } catch (err) {
    next(err)
  }
})

luckyGiftsRouter.get('/health', async (_req, res, next) => {
  try {
    sendOk(res, await getLuckyGiftHealthReport())
  } catch (err) {
    next(err)
  }
})

luckyGiftsRouter.post('/sync', requireSuperAdmin, async (req, res, next) => {
  try {
    const data = await syncLuckyGifts({ trigger: 'manual-all' })
    sendOk(res, data)
  } catch (err) {
    next(err)
  }
})

luckyGiftsRouter.post('/sync/:liveAccountId', requireSuperAdmin, async (req, res, next) => {
  try {
    const raw = String(req.params.liveAccountId || '').trim()
    const shopKey = resolveGoodReviewShopKey(raw)
    if (!shopKey) {
      // 允许直接传 shopKey；若是 liveAccountId 则反查 shop
      const { prisma } = await import('../lib/prisma')
      const { resolveShopKeyFromPlatformName, resolveShopKeyFromAccountName } = await import(
        '../services/official-shop-account.service'
      )
      const acc = await prisma.platformCredential.findUnique({ where: { id: raw } })
      const key =
        (acc && resolveShopKeyFromPlatformName(acc.platformName)) ||
        (acc && resolveShopKeyFromAccountName(acc.displayName)) ||
        null
      if (!key) {
        sendFail(res, '无效的店铺或直播号', 400)
        return
      }
      const data = await syncLuckyGifts({ trigger: 'manual-one', shopKey: key })
      sendOk(res, data)
      return
    }
    const data = await syncLuckyGifts({ trigger: 'manual-one', shopKey })
    sendOk(res, data)
  } catch (err) {
    next(err)
  }
})

luckyGiftsRouter.post(
  '/winners/:id/sf-fee/refresh',
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim()
      const winner = await prisma.xhsLuckyWinner.findUnique({
        where: { id },
        include: { shipment: true },
      })
      if (!winner?.shipment) {
        sendFail(res, '记录不存在或未发货', 404)
        return
      }
      const tracking = winner.shipment.trackingNo ?? winner.officialTrackingNo
      if (!tracking) {
        sendFail(res, '暂无运单号', 400)
        return
      }
      const { queryAndCacheSfFeeForShipment } = await import(
        '../services/lucky-gift/lucky-gift-sf-fee.service'
      )
      const data = await queryAndCacheSfFeeForShipment(winner.shipment.id, tracking, true)
      sendOk(res, data)
    } catch (err) {
      next(err)
    }
  },
)

luckyGiftsRouter.get('/sf-route-stats', async (req, res, next) => {
  try {
    const accountId = String(req.query.accountId ?? '').trim() || undefined
    let accountIds: string[] | null = null
    if (accountId && accountId !== 'all') {
      const shopKey = resolveGoodReviewShopKey(accountId)
      if (shopKey) {
        const { resolveOfficialShopAccountForStatus } = await import(
          '../services/official-shop-account.service'
        )
        const acc = await resolveOfficialShopAccountForStatus(shopKey)
        accountIds = acc?.id ? [acc.id] : ['__none__']
      } else {
        accountIds = [accountId]
      }
    }
    const { getLuckyGiftSfRouteStats } = await import(
      '../services/lucky-gift/lucky-gift-sf-route.service'
    )
    sendOk(res, await getLuckyGiftSfRouteStats(accountIds))
  } catch (err) {
    next(err)
  }
})

luckyGiftsRouter.post('/sf-routes/refresh', requireSuperAdmin, async (req, res, next) => {
  try {
    const maxQueries = req.body?.maxQueries != null ? Number(req.body.maxQueries) : 40
    const force = Boolean(req.body?.force)
    const accountId = String(req.body?.accountId ?? req.query.accountId ?? '').trim() || undefined
    let accountIds: string[] | null = null
    if (accountId && accountId !== 'all') {
      const shopKey = resolveGoodReviewShopKey(accountId)
      if (shopKey) {
        const { resolveOfficialShopAccountForStatus } = await import(
          '../services/official-shop-account.service'
        )
        const acc = await resolveOfficialShopAccountForStatus(shopKey)
        accountIds = acc?.id ? [acc.id] : ['__none__']
      } else {
        accountIds = [accountId]
      }
    }
    const { refreshLuckyGiftSfRoutes, getLuckyGiftSfRouteStats } = await import(
      '../services/lucky-gift/lucky-gift-sf-route.service'
    )
    const refresh = await refreshLuckyGiftSfRoutes({ maxQueries, force, accountIds })
    const stats = await getLuckyGiftSfRouteStats(accountIds)
    sendOk(res, { refresh, stats })
  } catch (err) {
    next(err)
  }
})

luckyGiftsRouter.post(
  '/winners/:id/sf-route/refresh',
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim()
      const winner = await prisma.xhsLuckyWinner.findUnique({
        where: { id },
        include: { shipment: true },
      })
      if (!winner?.shipment) {
        sendFail(res, '记录不存在或未发货', 404)
        return
      }
      const tracking = winner.shipment.trackingNo ?? winner.officialTrackingNo
      if (!tracking) {
        sendFail(res, '暂无运单号', 400)
        return
      }
      const { queryAndCacheSfRouteForShipment } = await import(
        '../services/lucky-gift/lucky-gift-sf-route.service'
      )
      const data = await queryAndCacheSfRouteForShipment(
        winner.shipment.id,
        tracking,
        winner.recipientPhone,
        true,
      )
      sendOk(res, data)
    } catch (err) {
      next(err)
    }
  },
)

luckyGiftsRouter.post(
  '/qianfan-ticket',
  requireRole('super_admin', 'boss', 'staff'),
  async (req, res, next) => {
    try {
      if (!canViewLuckyGiftPii(req.user?.role)) {
        sendFail(res, '当前账号无权操作', 403)
        return
      }
      const winnerId = String(req.body?.winnerId ?? '').trim()
      if (!winnerId) {
        sendFail(res, '缺少中奖记录 ID', 400)
        return
      }
      const data = await createLuckyGiftQianfanOpenTicket(winnerId)
      sendOk(res, data)
    } catch (err) {
      if (err instanceof QianfanOrderOpenTicketError) {
        sendFail(res, err.message, 400)
        return
      }
      next(err)
    }
  },
)

luckyGiftsRouter.patch(
  '/winners/:id/shipment',
  requireRole('super_admin', 'boss', 'staff'),
  async (req, res, next) => {
    try {
      if (!canViewLuckyGiftPii(req.user?.role)) {
        sendFail(res, '当前账号无权操作发货', 403)
        return
      }
      const id = String(req.params.id || '').trim()
      if (!id) {
        sendFail(res, '缺少中奖记录 ID', 400)
        return
      }
      const undo = Boolean(req.body?.undo)
      const data = await markLuckyGiftShipped({
        winnerId: id,
        courierCompany: req.body?.courierCompany ?? null,
        trackingNo: req.body?.trackingNo ?? null,
        note: req.body?.note ?? null,
        operatorId: req.user?.id ?? null,
        operatorName: req.user?.name || req.user?.username || null,
        undo,
      })
      sendOk(res, data)
    } catch (err) {
      next(err)
    }
  },
)

luckyGiftsRouter.post(
  '/shipments/batch',
  requireRole('super_admin', 'boss', 'staff'),
  async (req, res, next) => {
    try {
      const winnerIds = Array.isArray(req.body?.winnerIds)
        ? req.body.winnerIds.map((x: unknown) => String(x))
        : []
      if (winnerIds.length === 0) {
        sendFail(res, '请选择要标记的记录', 400)
        return
      }
      const data = await batchMarkLuckyGiftShipped({
        winnerIds,
        courierCompany: req.body?.courierCompany ?? null,
        trackingNo: req.body?.trackingNo ?? null,
        note: req.body?.note ?? null,
        operatorId: req.user?.id ?? null,
        operatorName: req.user?.name || req.user?.username || null,
      })
      sendOk(res, data)
    } catch (err) {
      next(err)
    }
  },
)

/** 可选：服务端生成复制文本（前端优先 Clipboard；无权限时拒绝） */
luckyGiftsRouter.get('/export', async (req, res, next) => {
  try {
    if (!canViewLuckyGiftPii(req.user?.role)) {
      sendFail(res, '当前账号无权导出完整地址', 403)
      return
    }
    const mode = String(req.query.mode ?? 'pending').trim()
    const list = await listLuckyGifts({
      accountId: String(req.query.accountId ?? '').trim() || undefined,
      status: mode === 'audit' ? 'all' : 'pending',
      dateRange: String(req.query.dateRange ?? '').trim() || undefined,
      startDate: String(req.query.startDate ?? '').trim() || undefined,
      endDate: String(req.query.endDate ?? '').trim() || undefined,
      keyword: String(req.query.keyword ?? '').trim() || undefined,
      page: 1,
      pageSize: 500,
      role: req.user?.role,
    })
    const text =
      mode === 'audit'
        ? buildLuckyGiftAuditCopyText(list.items)
        : buildLuckyGiftShipCopyText(
            list.items.filter((i) => i.shipmentStatus === 'pending' && i.addressComplete),
          )
    sendOk(res, { text, count: list.items.length })
  } catch (err) {
    next(err)
  }
})
