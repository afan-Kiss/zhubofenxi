import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import {
  isAccessLogEnabled,
  logError,
  logInfo,
  logWarn,
} from '../utils/server-log'

const STATIC_EXT_RE = /\.(js|css|map|png|jpg|jpeg|svg|ico|woff|woff2|ttf|eot)$/i

const QUIET_API_PATHS = new Set([
  '/api/board/sync-meta',
  '/api/board/local-data',
  '/api/settings/display-settings',
  '/api/board/buyer-profile',
  '/api/board/anchor-drill',
])

const SENSITIVE_QUERY_KEYS = new Set([
  'cookie',
  'token',
  'password',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'x-xsrf-token',
])

function headerStr(req: Request, name: string): string {
  const raw = req.headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]?.trim() ?? ''
  return typeof raw === 'string' ? raw.trim() : ''
}

function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) return ip.slice(7)
  return ip
}

export function resolveClientIp(req: Request): {
  clientIp: string
  forwardedFor: string
  remoteAddress: string
} {
  const forwardedFor = headerStr(req, 'x-forwarded-for')
  const xRealIp = headerStr(req, 'x-real-ip')
  const remoteAddress = normalizeIp(req.socket.remoteAddress ?? '')

  let clientIp = ''
  if (forwardedFor) {
    clientIp = normalizeIp(forwardedFor.split(',')[0]?.trim() ?? '')
  }
  if (!clientIp && xRealIp) {
    clientIp = normalizeIp(xRealIp)
  }
  if (!clientIp && req.ip) {
    clientIp = normalizeIp(req.ip)
  }
  if (!clientIp) {
    clientIp = remoteAddress || 'unknown'
  }

  return { clientIp, forwardedFor, remoteAddress }
}

function sanitizeQueryUrl(originalUrl: string): string {
  const qIndex = originalUrl.indexOf('?')
  if (qIndex < 0) return originalUrl

  const pathPart = originalUrl.slice(0, qIndex)
  const query = originalUrl.slice(qIndex + 1)
  if (!query) return pathPart

  const params = new URLSearchParams(query)
  let changed = false
  for (const key of params.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      params.set(key, '***')
      changed = true
    }
  }
  if (!changed) return originalUrl
  return `${pathPart}?${params.toString()}`
}

function isStaticPath(pathname: string): boolean {
  if (pathname.startsWith('/assets/')) return true
  if (pathname === '/favicon.ico') return true
  if (pathname.startsWith('/manifest')) return true
  if (STATIC_EXT_RE.test(pathname)) return true
  return false
}

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return false
  if (ip.startsWith('127.') || ip.startsWith('10.')) return true
  if (ip.startsWith('192.168.')) return true
  if (ip.startsWith('172.')) {
    const second = Number.parseInt(ip.split('.')[1] ?? '0', 10)
    if (second >= 16 && second <= 31) return true
  }
  return false
}

export function detectAccessSource(req: Request, clientIp: string): string {
  const host = headerStr(req, 'host').toLowerCase()
  if (host.includes('vicp.fun') || host.includes('oray') || host.includes('花生壳')) {
    return '花生壳'
  }
  if (host.includes('127.0.0.1') || host.includes('localhost')) return '本机'
  if (isPrivateIp(clientIp)) return '局域网'
  return '外网'
}

function shortUa(ua: string): string {
  if (!ua) return '未知'
  if (/MicroMessenger/i.test(ua)) return '微信'
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/Firefox\//i.test(ua)) return 'Firefox'
  if (/Chrome\//i.test(ua)) return 'Chrome'
  if (/Safari\//i.test(ua)) return 'Safari'
  return '未知'
}

function formatSize(bytes: number | null): string {
  if (bytes == null || bytes < 0 || Number.isNaN(bytes)) return '-'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}

function parseContentLength(res: Response): number | null {
  const raw = res.getHeader('content-length')
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
  return Number.isFinite(n) ? n : null
}

type AccessKind = 'page' | 'api' | 'static' | 'health'

function classifyAccess(pathname: string): {
  kind: AccessKind
  logStart: boolean
} {
  if (pathname === '/api/health') {
    return { kind: 'health', logStart: false }
  }
  if (pathname.startsWith('/api/')) {
    if (QUIET_API_PATHS.has(pathname)) {
      return { kind: 'api', logStart: false }
    }
    return { kind: 'api', logStart: true }
  }
  if (isStaticPath(pathname)) {
    return { kind: 'static', logStart: false }
  }
  return { kind: 'page', logStart: true }
}

function shouldLogFinish(input: {
  kind: AccessKind
  statusCode: number
  durationMs: number
  logStart: boolean
}): boolean {
  if (input.kind === 'static') {
    return input.statusCode >= 400
  }
  if (input.kind === 'health') {
    return input.statusCode >= 400 || input.durationMs > 2000
  }
  if (input.kind === 'api' && !input.logStart) {
    return input.statusCode >= 400 || input.durationMs >= 5000
  }
  return true
}

function slowLabel(kind: AccessKind, durationMs: number): string | null {
  if (durationMs >= 15000) return '疑似卡住'
  if (kind === 'page' && durationMs >= 3000) return '慢请求'
  if (kind === 'api' && durationMs >= 5000) return '慢请求'
  if (kind === 'health' && durationMs >= 2000) return '慢请求'
  return null
}

export function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAccessLogEnabled()) {
    next()
    return
  }

  const start = Date.now()
  const pathname = req.path || '/'
  const classification = classifyAccess(pathname)
  const requestId = (headerStr(req, 'x-request-id') || randomUUID()).slice(0, 8)
  req.requestId = req.requestId ?? requestId

  const { clientIp } = resolveClientIp(req)
  const host = headerStr(req, 'host') || '-'
  const userAgent = headerStr(req, 'user-agent')
  const source = detectAccessSource(req, clientIp)
  const safePath = sanitizeQueryUrl(req.originalUrl || pathname)

  if (classification.logStart) {
    logInfo(
      '访问开始',
      `id=${requestId} Host=${host} ${req.method} ${safePath} 来源=${source} IP=${clientIp} UA=${shortUa(userAgent)}`,
    )
  }

  res.on('finish', () => {
    const durationMs = Date.now() - start
    const statusCode = res.statusCode
    if (statusCode === 304 && classification.kind === 'static') return

    if (
      !shouldLogFinish({
        kind: classification.kind,
        statusCode,
        durationMs,
        logStart: classification.logStart,
      })
    ) {
      return
    }

    const contentLength = parseContentLength(res)
    const endLine = `id=${requestId} 状态=${statusCode} 耗时=${durationMs}ms 大小=${formatSize(contentLength)}`
    const slow = slowLabel(classification.kind, durationMs)

    if (statusCode >= 500) {
      logError('访问结束', endLine)
    } else if (statusCode >= 400) {
      logWarn('访问结束', endLine)
    } else {
      logInfo('访问结束', endLine)
    }

    if (slow === '疑似卡住') {
      logWarn('疑似卡住', `${endLine} path=${safePath} 来源=${source}`)
    } else if (slow === '慢请求') {
      logWarn('慢请求', `${endLine} path=${safePath}`)
    }
  })

  next()
}
