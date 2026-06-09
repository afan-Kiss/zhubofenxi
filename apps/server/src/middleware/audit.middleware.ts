import type { NextFunction, Request, Response } from 'express'
import { createRequestId, writeOperationLog } from '../services/audit.service'
import type { AuditAction, AuditModule } from '../types/audit'

declare global {
  namespace Express {
    interface Request {
      requestId?: string
      auditStartMs?: number
    }
  }
}

interface RouteAuditRule {
  method: string
  pathMatch: RegExp
  action: AuditAction
  module: AuditModule
  description: (req: Request, statusCode: number) => string
}

const ROUTE_RULES: RouteAuditRule[] = [
  {
    method: 'GET',
    pathMatch: /^\/api\/dashboard\/overview$/,
    action: 'view_dashboard',
    module: 'dashboard',
    description: () => '查看经营看板',
  },
  {
    method: 'POST',
    pathMatch: /^\/api\/dashboard\/refresh$/,
    action: 'refresh_dashboard',
    module: 'dashboard',
    description: () => '刷新最新数据',
  },
  {
    method: 'GET',
    pathMatch: /^\/api\/users$/,
    action: 'view_admin',
    module: 'admin',
    description: () => '查看用户管理',
  },
  {
    method: 'GET',
    pathMatch: /^\/api\/settings\/credential$/,
    action: 'view_config',
    module: 'settings',
    description: () => '查看系统设置',
  },
  {
    method: 'PUT',
    pathMatch: /^\/api\/settings\/credential$/,
    action: 'save_cookie',
    module: 'settings',
    description: () => '保存平台 Cookie',
  },
  {
    method: 'POST',
    pathMatch: /^\/api\/settings\/credential\/test$/,
    action: 'test_cookie',
    module: 'settings',
    description: () => '测试 Cookie 保存',
  },
  {
    method: 'PUT',
    pathMatch: /^\/api\/settings\/download-configs\//,
    action: 'save_download_config',
    module: 'settings',
    description: (req) => `保存下载配置 ${req.params.type ?? ''}`,
  },
  {
    method: 'POST',
    pathMatch: /^\/api\/download\/all$/,
    action: 'trigger_download_all',
    module: 'download',
    description: () => '触发全部下载',
  },
  {
    method: 'POST',
    pathMatch: /^\/api\/download\/[^/]+$/,
    action: 'trigger_download',
    module: 'download',
    description: (req) => `触发单表下载 ${req.path.split('/').pop() ?? ''}`,
  },
  {
    method: 'GET',
    pathMatch: /^\/api\/audit\/logs$/,
    action: 'view_operation_logs',
    module: 'system',
    description: () => '查看操作日志',
  },
  {
    method: 'POST',
    pathMatch: /^\/api\/users$/,
    action: 'create_user',
    module: 'user',
    description: () => '新增用户',
  },
  {
    method: 'PUT',
    pathMatch: /^\/api\/users\//,
    action: 'update_user',
    module: 'user',
    description: () => '修改用户',
  },
]

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? ''
  if (Array.isArray(forwarded)) return forwarded[0] ?? ''
  return req.socket.remoteAddress ?? ''
}

function matchRule(req: Request): RouteAuditRule | null {
  const path = req.path
  for (const rule of ROUTE_RULES) {
    if (rule.method !== req.method) continue
    if (rule.pathMatch.test(path)) return rule
  }
  return null
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = createRequestId()
  req.auditStartMs = Date.now()

  res.on('finish', () => {
    const rule = matchRule(req)
    if (!rule) return
    if (res.statusCode >= 500) return

    const durationMs = Date.now() - (req.auditStartMs ?? Date.now())
    const user = req.user

    void writeOperationLog({
      userId: user?.id,
      username: user?.username,
      role: user?.role,
      action: rule.action,
      module: rule.module,
      description: rule.description(req, res.statusCode),
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
      path: req.path,
      method: req.method,
      requestId: req.requestId,
      durationMs,
      meta: {
        statusCode: res.statusCode,
        type: req.params.type,
      },
    })
  })

  next()
}

export { getClientIp }
