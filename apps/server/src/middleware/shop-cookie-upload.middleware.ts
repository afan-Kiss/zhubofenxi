import type { NextFunction, Request, Response } from 'express'

/** Cookie 上传/状态：内部自用，不强制 Token */
export function allowShopCookieAccess(_req: Request, _res: Response, next: NextFunction): void {
  next()
}
