import type { NextFunction, Request, Response } from 'express'
import { sendFail } from '../utils/response'
import { resolveRequestUser } from '../services/auth.service'

export type { SessionUser } from '../types/auth'

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const user = req.user ?? (await resolveRequestUser(req))
    if (!user) {
      sendFail(res, '请先登录', 401)
      return
    }
    req.user = user
    next()
  })().catch(next)
}
