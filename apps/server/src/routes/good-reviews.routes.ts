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
import { updateGoodReviewMaterialTags } from '../services/good-review/good-review-material-tags.service'
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
import { diagnoseGoodReviewImages } from '../services/good-review/good-review-image-diagnostics.service'
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
      const accept = String(req.headers.accept ?? '')
      if (accept.includes('image/') || accept.includes('*/*')) {
        res.status(502)
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.send(
          `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect width="320" height="120" fill="#f8fafc"/><text x="160" y="56" text-anchor="middle" fill="#64748b" font-size="14">图片加载失败</text><text x="160" y="78" text-anchor="middle" fill="#94a3b8" font-size="11">${result.message.replace(/[<>&"]/g, '')}</text></svg>`,
        )
        return
      }
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

goodReviewsRouter.get('/image-diagnostics', async (req, res, next) => {
  try {
    const shop = String(req.query.shop ?? '').trim() || undefined
    if (shop && !resolveGoodReviewShopKey(shop)) {
      sendFail(res, '无效的店铺参数')
      return
    }
    const limitRaw = req.query.limit
    const limit =
      limitRaw != null && String(limitRaw).trim() !== '' ? Number(limitRaw) : undefined
    const data = await diagnoseGoodReviewImages({ shop, limit })
    sendOk(res, data)
  } catch (err) {
    next(err)
  }
})

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
    const hasImage = String(req.query.hasImage ?? '').trim() === 'true' ? true : undefined
    const hasText = String(req.query.hasText ?? '').trim() === 'true' ? true : undefined
    const replyStatusRaw = String(req.query.replyStatus ?? '').trim()
    const replyStatus =
      replyStatusRaw === 'replied' || replyStatusRaw === 'unreplied' ? replyStatusRaw : undefined
    const itemKeyword = String(req.query.itemKeyword ?? '').trim() || undefined
    const reviewKeyword = String(req.query.reviewKeyword ?? '').trim() || undefined
    const minScoreRaw = String(req.query.minProductScore ?? '').trim()
    const minProductScore =
      minScoreRaw && Number.isFinite(Number(minScoreRaw)) ? Number(minScoreRaw) : undefined
    const materialTag = String(req.query.materialTag ?? '').trim() || undefined
    const data = await queryGoodReviews({
      shop: shop || undefined,
      limit,
      cursor,
      days,
      startDate,
      endDate,
      hasImage,
      hasText,
      replyStatus,
      itemKeyword,
      reviewKeyword,
      minProductScore,
      materialTag,
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

goodReviewsRouter.post('/:id/material-tags', async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '').trim()
    if (!id) {
      sendFail(res, '无效的评价 ID')
      return
    }
    const tags = (req.body as { tags?: unknown })?.tags
    const updated = await updateGoodReviewMaterialTags({ id, tags: tags as string[] })
    if (!updated) {
      sendFail(res, '未找到该条好评', 404)
      return
    }
    sendOk(res, { review: updated })
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
