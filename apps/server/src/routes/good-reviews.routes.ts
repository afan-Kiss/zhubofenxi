import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { sendFail, sendOk } from '../utils/response'
import { isGoodReviewShopKey, resolveGoodReviewShopKey } from '../config/good-review-shops.constants'
import { queryGoodReviews } from '../services/good-review/good-review-query.service'
import { syncGoodReviews } from '../services/good-review/good-review-sync.service'

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
