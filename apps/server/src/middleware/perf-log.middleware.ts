import type { NextFunction, Request, Response } from 'express'

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(2)}MB`
}

function parseContentLength(value: string | number | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

import { isPerfLogEnabled } from '../utils/server-log'

/** ENABLE_PERF_LOG=true 时输出接口耗时与响应体大小 */
export function perfLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isPerfLogEnabled()) {
    next()
    return
  }

  const started = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    const len = parseContentLength(res.getHeader('content-length') as string | undefined)
    const sizeLabel = len != null ? formatBytes(len) : '—'
    console.log(
      `[perf] ${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${ms.toFixed(0)}ms ${sizeLabel}`,
    )
  })
  next()
}
