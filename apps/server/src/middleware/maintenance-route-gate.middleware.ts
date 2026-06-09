import type { RequestHandler, Router } from 'express'
import { isMaintenanceToolsEnabled } from '../config/env'
import { sendDeprecatedApi } from '../utils/deprecated-api'

/** 仅在 ENABLE_MAINTENANCE_TOOLS=true 时挂载维护类路由 */
export function maintenanceRouteGate(label: string): RequestHandler {
  return (req, res, next) => {
    if (isMaintenanceToolsEnabled()) {
      next()
      return
    }
    sendDeprecatedApi(
      res,
      `${label} 仅在维护模式开放（设置 ENABLE_MAINTENANCE_TOOLS=true）。`,
    )
  }
}

export function mountMaintenanceRouter(
  app: import('express').Express,
  path: string,
  router: Router,
  label: string,
): void {
  app.use(path, maintenanceRouteGate(label), router)
}
