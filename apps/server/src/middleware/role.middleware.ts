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
      sendFail(res, '当前账号没有执行权限', 403)
      return
    }
    next()
  }
}

/** 仅超级管理员；正式业务能力用此中间件，不依赖 ENABLE_MAINTENANCE_TOOLS */
export const requireSuperAdmin = requireRole('super_admin')
