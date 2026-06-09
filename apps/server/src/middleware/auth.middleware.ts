import type { NextFunction, Request, Response } from 'express'
import { sendFail } from '../utils/response'
import {
  resolveUserFromSessionToken,
  SESSION_COOKIE_NAME,
} from '../services/session.service'

export type { SessionUser } from '../types/auth'

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const token = req.cookies?.[SESSION_COOKIE_NAME]
    if (!token || typeof token !== 'string') {
      sendFail(res, '请先登录', 401)
      return
    }

    const user = await resolveUserFromSessionToken(token)
    if (!user) {
      sendFail(res, '请先登录', 401)
      return
    }
    req.user = user
    next()
  })().catch(next)
}
