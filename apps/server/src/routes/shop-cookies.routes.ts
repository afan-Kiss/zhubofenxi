import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { allowShopCookieAccess } from '../middleware/shop-cookie-upload.middleware'
import {
  getShopCookieStatusPayload,
  uploadShopCookies,
} from '../services/shop-cookie-upload.service'
import { sendFail, sendOk } from '../utils/response'

export const shopCookiesRouter = Router()

shopCookiesRouter.use(attachRequestUser)

/** 查看四店 Cookie 配置状态（不返回明文） */
shopCookiesRouter.get('/status', allowShopCookieAccess, async (_req, res, next) => {
  try {
    const payload = await getShopCookieStatusPayload()
    sendOk(res, payload)
  } catch (err) {
    next(err)
  }
})

/** 四店 Cookie 统一健康检查（fresh=1 时强制真实接口探测） */
shopCookiesRouter.get('/health', allowShopCookieAccess, async (req, res, next) => {
  try {
    const { getShopCookieHealthPayload } = await import('../services/shop-cookie-health.service')
    const fresh = String(req.query.fresh ?? '') === '1' || String(req.query.fresh ?? '') === 'true'
    const payload = await getShopCookieHealthPayload({ fresh })
    sendOk(res, payload)
  } catch (err) {
    next(err)
  }
})

const uploadHandler = async (
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) => {
  try {
    const updatedBy = req.user?.id ?? 'shop-cookie-upload'
    const result = await uploadShopCookies({
      body: req.body,
      updatedBy,
    })
    sendOk(res, result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '更新 Cookie 失败'
    sendFail(res, message, 400)
  }
}

shopCookiesRouter.post('/update', allowShopCookieAccess, uploadHandler)
shopCookiesRouter.post('/', allowShopCookieAccess, uploadHandler)
