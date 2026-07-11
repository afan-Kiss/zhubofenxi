import type { NextFunction, Request, Response } from 'express'
import type { PagePermissionKey } from '../config/page-permissions'
import { getEffectivePagePermissionsForRole } from '../services/page-permission.service'
import { sendFail } from '../utils/response'

export function requirePagePermission(key: PagePermissionKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const role = req.user?.role
      if (!role) {
        sendFail(res, '未登录', 401)
        return
      }
      const perms = await getEffectivePagePermissionsForRole(role)
      if (!perms[key]) {
        sendFail(res, '无权限访问该功能', 403)
        return
      }
      next()
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '权限校验失败', 500)
    }
  }
}
