import type { NextFunction, Request, Response } from 'express'
import type { UserRole } from '../types/roles'
import { sendFail } from '../utils/response'

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user
    if (!user) {
      sendFail(res, '请先登录', 401)
      return
    }
    if (!roles.includes(user.role)) {
      sendFail(res, '没有权限执行此操作', 403)
      return
    }
    next()
  }
}
