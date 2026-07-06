import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { sendFail, sendOk } from '../utils/response'
import {
  getGoodReviewShopName,
  isGoodReviewShopKey,
  resolveGoodReviewShopKey,
} from '../config/good-review-shops.constants'
import { queryGoodReviews } from '../services/good-review/good-review-query.service'
import { syncGoodReviews } from '../services/good-review/good-review-sync.service'
import {
  buildGoodReviewArkOrderDetail,
  htmlGoodReviewArkOrderFallbackPage,
  QianfanOrderOpenTicketError,
} from '../services/qianfan-order-open-ticket.service'
import {
  closeGoodReviewImageSession,
  proxyGoodReviewImage,
  touchGoodReviewImageSession,
} from '../services/good-review/good-review-image-proxy.service'
import fs from 'node:fs'

export const goodReviewsRouter = Router()

goodReviewsRouter.get('/image-proxy', attachRequestUser, requireAuth, async (req, res, next) => {
  try {
    const rawUrl = String(req.query.url ?? '').trim()
    const sessionId = String(req.query.sessionId ?? '').trim() || undefined
    if (!rawUrl) {
      sendFail(res, '请提供 url 参数', 400)
      return
    }
    let decoded = rawUrl
    try {
      decoded = decodeURIComponent(rawUrl)
    } catch {
      decoded = rawUrl
    }
    const result = await proxyGoodReviewImage({ rawUrl: decoded, sessionId })
    if (!result.ok) {
      sendFail(res, result.message, 404)
      return
    }
    if (sessionId) touchGoodReviewImageSession(sessionId, decoded)
    res.setHeader('Content-Type', result.contentType)
    res.setHeader('Cache-Control', 'private, max-age=1800')
    fs.createReadStream(result.file).pipe(res)
  } catch (err) {
    next(err)
  }
})

goodReviewsRouter.post('/image-session/close', (req, res) => {
  const sessionId = String(req.body?.sessionId ?? '').trim()
  if (sessionId) closeGoodReviewImageSession(sessionId)
  sendOk(res, { ok: true })
})

goodReviewsRouter.use(attachRequestUser, requireAuth)

goodReviewsRouter.get('/', async (req, res, next) => {
  try {
    const shop = String(req.query.shop ?? '').trim()
    if (shop && !isGoodReviewShopKey(shop)) {
      sendFail(res, '无效的店铺参数')
      return
    }
    const limitRaw = req.query.limit
    const limit =
      limitRaw != null && String(limitRaw).trim() !== ''
        ? Number(limitRaw)
        : undefined
    const daysRaw = req.query.days
    const days =
      daysRaw != null && String(daysRaw).trim() !== '' ? Number(daysRaw) : undefined
    const cursor = String(req.query.cursor ?? '').trim() || undefined
    const startDate = String(req.query.startDate ?? '').trim() || undefined
    const endDate = String(req.query.endDate ?? '').trim() || undefined
    const data = await queryGoodReviews({
      shop: shop || undefined,
      limit,
      cursor,
      days,
      startDate,
      endDate,
    })
    sendOk(res, data)
  } catch (err) {
    next(err)
  }
})

goodReviewsRouter.post('/sync', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { shop?: string; days?: number }
    const shop = String(body.shop ?? 'all').trim() || 'all'
    if (shop !== 'all' && !resolveGoodReviewShopKey(shop)) {
      sendFail(res, '无效的店铺参数')
      return
    }
    const days = body.days != null ? Number(body.days) : 2
    const result = await syncGoodReviews({ shop, days })
    sendOk(res, result)
  } catch (err) {
    next(err)
  }
})

goodReviewsRouter.get('/ark-order-detail', async (req, res, next) => {
  try {
    const orderId = String(req.query.orderId ?? '').trim()
    const shop = String(req.query.shop ?? '').trim()
    const format = String(req.query.format ?? '').trim().toLowerCase()

    if (!orderId) {
      if (format === 'json') {
        sendFail(res, '请提供订单号')
        return
      }
      res
        .status(400)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          htmlGoodReviewArkOrderFallbackPage({
            serviceUrl: '',
            shopName: shop || '未知店铺',
            message: '请提供订单号',
          }),
        )
      return
    }

    if (!resolveGoodReviewShopKey(shop)) {
      if (format === 'json') {
        sendFail(res, '无效的店铺参数')
        return
      }
      res
        .status(400)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          htmlGoodReviewArkOrderFallbackPage({
            serviceUrl: '',
            shopName: shop || '未知店铺',
            message: '无效的店铺参数',
          }),
        )
      return
    }

    const result = await buildGoodReviewArkOrderDetail({ orderId, shop })

    if (format === 'json') {
      sendOk(res, result)
      return
    }

    if (!result.finalOpenUrl) {
      const shopKey = resolveGoodReviewShopKey(shop)
      res
        .status(400)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          htmlGoodReviewArkOrderFallbackPage({
            serviceUrl: result.serviceUrl,
            shopName: shopKey ? getGoodReviewShopName(shopKey) : shop || '未知店铺',
            message: result.error || '无法打开订单详情',
          }),
        )
      return
    }

    if (result.fallbackToBaseUrl && !result.hasTicket) {
      res
        .status(200)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          htmlGoodReviewArkOrderFallbackPage({
            serviceUrl: result.finalOpenUrl,
            shopName: result.shopName,
            message: '未能换到 ticket，已回退基础详情链接',
          }),
        )
      return
    }

    res.redirect(302, result.finalOpenUrl)
  } catch (err) {
    if (err instanceof QianfanOrderOpenTicketError) {
      const format = String(req.query.format ?? '').trim().toLowerCase()
      if (format === 'json') {
        sendFail(res, err.message, 400)
        return
      }
      res
        .status(400)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          htmlGoodReviewArkOrderFallbackPage({
            serviceUrl: '',
            shopName: String(req.query.shop ?? '未知店铺'),
            message: err.message,
          }),
        )
      return
    }
    next(err)
  }
})
