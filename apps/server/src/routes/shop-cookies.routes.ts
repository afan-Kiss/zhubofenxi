import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireShopCookieUploadAuth } from '../middleware/shop-cookie-upload.middleware'
import {
  getShopCookieStatus,
  uploadShopCookies,
} from '../services/shop-cookie-upload.service'
import { sendFail, sendOk } from '../utils/response'

export const shopCookiesRouter = Router()

shopCookiesRouter.use(attachRequestUser, requireShopCookieUploadAuth)

/** 查看四店 Cookie 配置状态（不返回明文） */
shopCookiesRouter.get('/status', async (_req, res, next) => {
  try {
    const shops = await getShopCookieStatus()
    sendOk(res, { shops, checkedAt: new Date().toISOString() })
  } catch (err) {
    next(err)
  }
})

/**
 * 批量提交/更新四店千帆 Cookie
 *
 * Body 示例：
 * {
 *   "shops": {
 *     "shiyuju": "cookie...",
 *     "hetianyayu": "cookie...",
 *     "xiangyu": "cookie...",
 *     "xyxiangyu": "cookie..."
 *   }
 * }
 *
 * 也支持单店：{ "shop": "shiyuju", "cookie": "..." }
 */
shopCookiesRouter.post('/update', async (req, res, next) => {
  try {
    const updatedBy = req.user?.id ?? 'shop-cookie-upload-token'
    const result = await uploadShopCookies({
      body: req.body,
      updatedBy,
    })
    sendOk(res, result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '更新 Cookie 失败'
    sendFail(res, message, 400)
  }
})

/** 与 /update 相同，便于脚本记忆 */
shopCookiesRouter.post('/', async (req, res, next) => {
  try {
    const updatedBy = req.user?.id ?? 'shop-cookie-upload-token'
    const result = await uploadShopCookies({
      body: req.body,
      updatedBy,
    })
    sendOk(res, result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '更新 Cookie 失败'
    sendFail(res, message, 400)
  }
})
