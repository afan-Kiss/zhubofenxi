import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { requirePagePermission } from '../middleware/page-permission.middleware'
import { sendFail, sendOk } from '../utils/response'
import { buildBossDashboardPayload, buildBossShopPayload } from '../services/boss-dashboard/boss-dashboard-query.service'
import { listBossBillOrders } from '../services/boss-dashboard/boss-dashboard-bill-query.service'
import {
  countUnreadAnnouncements,
  createManualAnnouncement,
  findPendingScoreDropPopup,
  listActiveAnnouncements,
  markAllAnnouncementsRead,
  markAnnouncementPopupShown,
  markAnnouncementRead,
} from '../services/boss-dashboard/boss-dashboard-announcement.service'
import { isGoodReviewShopKey } from '../config/good-review-shops.constants'
import { prisma } from '../lib/prisma'

export const bossDashboardRouter = Router()

bossDashboardRouter.use(attachRequestUser, requireAuth)

bossDashboardRouter.get('/', requirePagePermission('boss_dashboard'), async (req, res) => {
  try {
    const data = await buildBossDashboardPayload(req.user?.id)
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载老板看板失败', 500)
  }
})

bossDashboardRouter.get('/bill-orders', requirePagePermission('boss_dashboard'), async (req, res) => {
  try {
    const shopKeyRaw = String(req.query.shopKey ?? '').trim()
    const shopKey = shopKeyRaw && isGoodReviewShopKey(shopKeyRaw) ? shopKeyRaw : undefined
    const status = String(req.query.status ?? 'pending') === 'settled' ? 'settled' : 'pending'
    const page = Math.max(1, Number(req.query.page ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20) || 20))
    const data = await listBossBillOrders({ shopKey, status, page, pageSize })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载账单明细失败', 500)
  }
})

bossDashboardRouter.get('/bill-orders', requirePagePermission('boss_dashboard'), async (req, res) => {
  try {
    const shopKey = typeof req.query.shopKey === 'string' ? req.query.shopKey.trim() : undefined
    const status = req.query.status === 'settled' ? 'settled' : 'pending'
    const page = Math.max(1, Number(req.query.page ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20) || 20))
    const data = await listBossBillOrders({ shopKey, status, page, pageSize })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载账单明细失败', 500)
  }
})

bossDashboardRouter.get('/shops/:shopKey', requirePagePermission('boss_dashboard'), async (req, res) => {
  try {
    const shopKey = String(req.params.shopKey ?? '').trim()
    if (!isGoodReviewShopKey(shopKey)) {
      sendFail(res, '无效店铺标识', 400)
      return
    }
    const data = await buildBossShopPayload(shopKey, req.user?.id)
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载店铺详情失败', 500)
  }
})

bossDashboardRouter.get('/announcements', async (req, res) => {
  try {
    const userId = req.user!.id
    const announcements = await listActiveAnnouncements(userId)
    const unreadCount = await countUnreadAnnouncements(userId)
    const popupCandidate = await findPendingScoreDropPopup(userId)
    sendOk(res, { announcements, unreadCount, popupCandidate })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载公告失败', 500)
  }
})

bossDashboardRouter.post('/announcements/:id/read', async (req, res) => {
  try {
    await markAnnouncementRead(req.user!.id, String(req.params.id))
    sendOk(res, { ok: true })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '标记已读失败', 500)
  }
})

bossDashboardRouter.post('/announcements/read-all', async (req, res) => {
  try {
    await markAllAnnouncementsRead(req.user!.id)
    sendOk(res, { ok: true })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '全部已读失败', 500)
  }
})

bossDashboardRouter.post('/announcements/:id/popup-shown', async (req, res) => {
  try {
    await markAnnouncementPopupShown(req.user!.id, String(req.params.id))
    sendOk(res, { ok: true })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '记录弹窗失败', 500)
  }
})

bossDashboardRouter.post('/announcements', async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      sendFail(res, '仅超级管理员可发布公告', 403)
      return
    }
    const body = req.body as Record<string, unknown>
    const title = String(body.title ?? '').trim()
    const content = String(body.content ?? '').trim()
    if (!title || !content) {
      sendFail(res, '标题和内容不能为空', 400)
      return
    }
    const row = await createManualAnnouncement({
      title,
      content,
      startsAt: body.startsAt ? new Date(String(body.startsAt)) : null,
      endsAt: body.endsAt ? new Date(String(body.endsAt)) : null,
      enabled: body.enabled !== false,
      createdBy: req.user.username,
    })
    sendOk(res, row)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '发布公告失败', 500)
  }
})

bossDashboardRouter.patch('/announcements/:id', async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      sendFail(res, '仅超级管理员可管理公告', 403)
      return
    }
    const body = req.body as Record<string, unknown>
    const row = await prisma.bossAnnouncement.update({
      where: { id: String(req.params.id) },
      data: {
        title: body.title != null ? String(body.title) : undefined,
        content: body.content != null ? String(body.content) : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        startsAt: body.startsAt === null ? null : body.startsAt ? new Date(String(body.startsAt)) : undefined,
        endsAt: body.endsAt === null ? null : body.endsAt ? new Date(String(body.endsAt)) : undefined,
      },
    })
    sendOk(res, row)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '更新公告失败', 500)
  }
})
