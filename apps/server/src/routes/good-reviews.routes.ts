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

export const goodReviewsRouter = Router()

goodReviewsRouter.use(attachRequestUser, requireAuth)

goodReviewsRouter.get('/', async (req, res, next) => {
  try {
    const shop = String(req.query.shop ?? '').trim()
    if (shop && !isGoodReviewShopKey(shop)) {
      sendFail(res, '无效的店铺参数')
      return
    }
    const limit = Number(req.query.limit ?? 200)
    const data = await queryGoodReviews({ shop: shop || undefined, limit })
    sendOk(res, data)
  } catch (err) {
    next(err)
  }
})

goodReviewsRouter.post('/sync', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { shop?: string }
    const shop = String(body.shop ?? 'all').trim() || 'all'
    if (shop !== 'all' && !resolveGoodReviewShopKey(shop)) {
      sendFail(res, '无效的店铺参数')
      return
    }
    const result = await syncGoodReviews({ shop })
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

    if (result.hasTicket) {
      res.redirect(302, result.url)
      return
    }

    const shopKey = resolveGoodReviewShopKey(shop)!
    res
      .status(200)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        htmlGoodReviewArkOrderFallbackPage({
          serviceUrl: result.serviceUrl,
          shopName: getGoodReviewShopName(shopKey),
          message: result.error,
        }),
      )
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
