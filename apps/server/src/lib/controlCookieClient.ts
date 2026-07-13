import crypto from 'node:crypto'
import { loadEnv } from '../config/env'

const THREE_HOURS_MS = 3 * 60 * 60 * 1000
const DEFAULT_BASE = 'http://47.108.21.50/control'
const PROJECT_NAME = 'zhubo-analysis'

export interface ControlCookieResult {
  ok: boolean
  value: string
  updatedAt?: string
  cookieHash?: string
  source: 'control' | 'fallback'
  staleWarning?: string
  httpStatus?: number
  message?: string
}

function hashPrefix(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8)
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '')
}

function getControlConfig() {
  loadEnv()
  return {
    baseUrl: normalizeBaseUrl(process.env.CONTROL_SERVER_URL || DEFAULT_BASE),
    serviceToken: String(process.env.CONTROL_SERVICE_TOKEN || '').trim(),
    projectName: PROJECT_NAME,
  }
}

function logResolved(shopName: string, updatedAt: string | undefined, cookie: string): void {
  const hash8 = hashPrefix(cookie)
  console.log(
    `[control-cookie] shop=${shopName} updatedAt=${updatedAt || '-'} hash=${hash8} len=${cookie.length}`,
  )
}

/**
 * 从总控台 resolve 千帆 Cookie；失败时返回 fallbackValue（若提供）。
 */
export async function getQianfanCookie(params: {
  shopName: string
  projectName?: string
  fallbackValue?: string
}): Promise<ControlCookieResult> {
  const { baseUrl, serviceToken, projectName } = getControlConfig()
  const shopName = String(params.shopName || '').trim()
  const fallback = params.fallbackValue?.trim() || ''

  if (!serviceToken) {
    if (fallback) {
      console.warn(
        `[control-cookie] 未配置 CONTROL_SERVICE_TOKEN，已使用本地兜底配置。shop=${shopName}`,
      )
      return { ok: true, value: fallback, source: 'fallback', message: 'missing_service_token' }
    }
    return { ok: false, value: '', source: 'fallback', message: 'missing_service_token' }
  }

  let res: Response
  try {
    const query = new URLSearchParams({
      platform: 'qianfan',
      shopName,
      keyName: 'cookie',
    })
    res = await fetch(`${baseUrl}/api/secrets/resolve?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        'x-service-token': serviceToken,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (fallback) {
      console.warn(`[control-cookie] 总控台请求失败，已使用本地兜底配置。shop=${shopName} err=${msg}`)
      return { ok: true, value: fallback, source: 'fallback', message: msg }
    }
    return { ok: false, value: '', source: 'fallback', message: msg }
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>

  if (res.status === 404) {
    console.warn(`总控台暂时没有这个店铺的千帆 Cookie，已使用本地兜底配置。shop=${shopName}`)
    if (fallback) {
      return { ok: true, value: fallback, source: 'fallback', httpStatus: 404 }
    }
    return { ok: false, value: '', source: 'fallback', httpStatus: 404 }
  }

  if (res.status === 403) {
    console.warn(`总控服务令牌不正确，已使用本地兜底配置。shop=${shopName}`)
    if (fallback) {
      return { ok: true, value: fallback, source: 'fallback', httpStatus: 403 }
    }
    return { ok: false, value: '', source: 'fallback', httpStatus: 403 }
  }

  if (!res.ok) {
    const msg = String(data.error || `HTTP ${res.status}`)
    if (fallback) {
      console.warn(`[control-cookie] 总控台读取失败(${res.status})，已使用本地兜底。shop=${shopName}`)
      return { ok: true, value: fallback, source: 'fallback', httpStatus: res.status, message: msg }
    }
    return { ok: false, value: '', source: 'fallback', httpStatus: res.status, message: msg }
  }

  const value = String(data.value || '').trim()
  if (!value) {
    if (fallback) {
      return { ok: true, value: fallback, source: 'fallback', httpStatus: res.status }
    }
    return { ok: false, value: '', source: 'fallback', httpStatus: res.status }
  }

  const updatedAt = String(data.updatedAt || '')
  let staleWarning: string | undefined
  if (updatedAt) {
    const age = Date.now() - Date.parse(updatedAt)
    if (Number.isFinite(age) && age > THREE_HOURS_MS) {
      staleWarning = '千帆 Cookie 超过 3 小时未更新，请检查公司电脑千帆客服台是否在线。'
      console.warn(`[control-cookie] ${staleWarning} shop=${shopName}`)
    }
  }

  logResolved(shopName, updatedAt, value)
  return {
    ok: true,
    value,
    updatedAt,
    cookieHash: data.cookieHash ? String(data.cookieHash) : hashPrefix(value),
    source: 'control',
    staleWarning,
    httpStatus: res.status,
  }
}
