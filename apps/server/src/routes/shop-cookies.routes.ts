import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { allowShopCookieAccess } from '../middleware/shop-cookie-upload.middleware'
import {
  SHOP_COOKIE_API_UPLOAD_DISABLED_MESSAGE,
  isShopCookieApiUploadEnabled,
} from '../config/shop-cookie-api-upload.config'
import {
  getShopCookieStatusPayload,
  uploadShopCookies,
} from '../services/shop-cookie-upload.service'
import { getOfficialShopCookiePlaintext } from '../services/official-shop-account.service'
import { resolveGoodReviewShopKey } from '../config/good-review-shops.constants'
import { sendFail, sendOk } from '../utils/response'

function allowLoopbackOnly(req: Request, res: Response, next: NextFunction): void {
  const ip = String(req.socket.remoteAddress || '')
  const ok = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  if (!ok) {
    sendFail(res, '仅允许本机访问', 403)
    return
  }
  next()
}

export const shopCookiesRouter = Router()

shopCookiesRouter.use(attachRequestUser)

/** 本机读取四店明文 Cookie（祥钰/协议桥接兜底，不对外网暴露） */
shopCookiesRouter.get('/plain', allowLoopbackOnly, async (req, res, next) => {
  try {
    const raw = String(req.query.shopKey || req.query.shop || req.query.shopName || '').trim()
    if (!raw) {
      sendFail(res, '请提供 shopKey 或 shop 店铺名', 400)
      return
    }
    const shopKey = resolveGoodReviewShopKey(raw)
    if (!shopKey) {
      sendFail(res, `未知店铺: ${raw}`, 400)
      return
    }
    const row = await getOfficialShopCookiePlaintext(shopKey)
    if (!row?.cookie) {
      sendFail(res, '该店 Cookie 不可用或未配置', 404)
      return
    }
    sendOk(res, {
      shopKey: row.shopKey,
      shopName: row.shopName,
      cookie: row.cookie,
      cookieStatus: row.cookieStatus,
      accountId: row.accountId,
    })
  } catch (err) {
    next(err)
  }
})

/** 查看四店 Cookie 配置状态（不返回明文） */
shopCookiesRouter.get('/status', allowShopCookieAccess, async (_req, res, next) => {
  try {
    const payload = await getShopCookieStatusPayload()
    sendOk(res, payload)
  } catch (err) {
    next(err)
  }
})

/** 四店 Cookie 状态（只读库，不主动调平台接口；fresh=1 已废弃，与默认相同） */
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
  _next: import('express').NextFunction,
) => {
  if (!isShopCookieApiUploadEnabled()) {
    sendFail(res, SHOP_COOKIE_API_UPLOAD_DISABLED_MESSAGE, 403)
    return
  }
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
