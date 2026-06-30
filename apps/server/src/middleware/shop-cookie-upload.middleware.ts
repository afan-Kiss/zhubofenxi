import type { NextFunction, Request, Response } from 'express'
import { getShopCookieUploadToken } from '../config/env'
import { sendFail } from '../utils/response'

function readUploadToken(req: Request): string {
  const auth = String(req.headers.authorization || '').trim()
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  const headerKeys = ['x-shop-cookie-token', 'x-shop-cookie-upload-token'] as const
  for (const key of headerKeys) {
    const header = req.headers[key]
    if (typeof header === 'string' && header.trim()) return header.trim()
  }
  const body = req.body as Record<string, unknown> | undefined
  if (body && typeof body.uploadToken === 'string' && body.uploadToken.trim()) {
    return body.uploadToken.trim()
  }
  return ''
}

function tokenMatches(req: Request): boolean {
  const expected = getShopCookieUploadToken()
  const provided = readUploadToken(req)
  return Boolean(expected && provided && provided === expected)
}

/** 专用上传 Token，或已登录 super_admin */
export function requireShopCookieUploadAuth(req: Request, res: Response, next: NextFunction): void {
  if (tokenMatches(req)) {
    next()
    return
  }

  if (req.user?.role === 'super_admin') {
    next()
    return
  }

  if (!getShopCookieUploadToken()) {
    sendFail(res, '服务器未配置 SHOP_COOKIE_UPLOAD_TOKEN', 503)
    return
  }

  sendFail(res, '上传 Token 无效', 401)
}

/** 查看状态：上传 Token、任意已登录用户、或 super_admin */
export function requireShopCookieStatusAuth(req: Request, res: Response, next: NextFunction): void {
  if (tokenMatches(req)) {
    next()
    return
  }
  if (req.user) {
    next()
    return
  }
  if (!getShopCookieUploadToken()) {
    sendFail(res, '服务器未配置 SHOP_COOKIE_UPLOAD_TOKEN', 503)
    return
  }
  sendFail(res, '需要上传 Token 或登录后查看', 401)
}
