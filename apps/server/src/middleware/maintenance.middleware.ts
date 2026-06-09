import type { NextFunction, Request, Response } from 'express'
import { isMaintenanceToolsEnabled } from '../config/env'
import { sendFail } from '../utils/response'

/** 维护类写操作仅在 ENABLE_MAINTENANCE_TOOLS=true 时开放 */
export function requireMaintenanceTools(_req: Request, res: Response, next: NextFunction): void {
  if (!isMaintenanceToolsEnabled()) {
    sendFail(res, '该维护功能未启用', 404)
    return
  }
  next()
}
