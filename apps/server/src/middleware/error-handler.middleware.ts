import type { NextFunction, Request, Response } from 'express'
import { isProduction } from '../config/env'
import { writeOperationLog } from '../services/audit.service'

export function errorHandlerMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message =
    err instanceof Error && err.message
      ? err.message
      : '服务器内部错误，请稍后重试'

  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status: number }).status === 'number'
      ? (err as { status: number }).status
      : message.includes('权限') || message.includes('登录')
        ? 403
        : message.includes('不存在') || message.includes('未找到')
          ? 404
          : 500

  const user = req.user

  void writeOperationLog({
    userId: user?.id ?? null,
    username: user?.username ?? null,
    role: user?.role ?? null,
    action: 'api_error',
    module: 'system',
    description: `API 错误：${message}`,
    requestId: req.requestId ?? null,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    meta: {
      path: req.path,
      method: req.method,
      status,
      detail: !isProduction() && err instanceof Error ? err.stack : undefined,
    },
  })

  const payload: { ok: false; success: false; message: string; detail?: string } = {
    ok: false,
    success: false,
    message: status >= 500 && isProduction() ? '服务器繁忙，请稍后重试' : message,
  }

  if (!isProduction() && err instanceof Error && err.stack) {
    payload.detail = err.stack
  }

  if (!res.headersSent) {
    res.status(status).json(payload)
  }
}
