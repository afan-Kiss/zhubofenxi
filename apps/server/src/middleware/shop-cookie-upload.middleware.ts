import type { NextFunction, Request, Response } from 'express'
import { getShopCookieUploadToken } from '../config/env'
import { sendFail } from '../utils/response'

function readUploadToken(req: Request): string {
  const auth = String(req.headers.authorization || '').trim()
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  const header = req.headers['x-shop-cookie-token']
  if (typeof header === 'string') return header.trim()
  return ''
}

/** 专用上传 Token，或已登录 super_admin */
export function requireShopCookieUploadAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = getShopCookieUploadToken()
  const provided = readUploadToken(req)

  if (expected && provided && provided === expected) {
    next()
    return
  }

  if (req.user?.role === 'super_admin') {
    next()
    return
  }

  if (!expected) {
    sendFail(res, '服务端未配置 SHOP_COOKIE_UPLOAD_TOKEN，请由管理员登录后提交，或先在 .env 配置上传 Token', 503)
    return
  }

  sendFail(res, '上传 Token 无效', 401)
}
