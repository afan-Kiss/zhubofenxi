import { URL } from 'node:url'
import { getDecryptedCookie } from '../credential.service'
import { getDecryptedCookieByAccountId } from '../live-account.service'
import { writeOperationLog } from '../audit.service'
import type { AuditAction } from '../../types/audit'
import { requestXhsJson, type XhsRequestAuditContext } from '../xhs-http.service'
import { XhsAuthError, classifyXhsErrorMessage } from '../../utils/xhs-auth.util'
import { getApiDefinition, isApiConfigured } from './xhs-api-registry'
import { enqueueXhsRequest } from './xhs-rate-limiter.service'
import type { XhsApiKey, XhsApiRawSummary, XhsApiRequestResult } from './xhs-api-types'
import { XHS_API_NOT_CONFIGURED_MSG } from './xhs-api-types'

function urlPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.slice(0, 120)
  }
}

function buildRawSummary(payload: unknown): XhsApiRawSummary | null {
  if (!payload || typeof payload !== 'object') return null
  const o = payload as Record<string, unknown>
  const data = (o.data && typeof o.data === 'object' ? o.data : o) as Record<string, unknown>
  const list = data.packages ?? data.list ?? data.records ?? data.items
  const itemCount = Array.isArray(list) ? list.length : undefined
  return {
    code: typeof o.code === 'number' || typeof o.code === 'string' ? o.code : undefined,
    success: typeof o.success === 'boolean' ? o.success : undefined,
    msg: typeof o.msg === 'string' ? o.msg : typeof o.message === 'string' ? o.message : undefined,
    total:
      typeof data.total === 'number'
        ? data.total
        : typeof data.totalCount === 'number'
          ? data.totalCount
          : undefined,
    pageNum:
      typeof data.pageNum === 'number'
        ? data.pageNum
        : typeof data.pageNo === 'number'
          ? data.pageNo
          : typeof data.page === 'number'
            ? data.page
            : undefined,
    pageSize:
      typeof data.pageSize === 'number'
        ? data.pageSize
        : typeof data.size === 'number'
          ? data.size
          : undefined,
    itemCount,
  }
}

async function logApiRequest(
  action: AuditAction,
  apiKey: XhsApiKey,
  def: ReturnType<typeof getApiDefinition>,
  summary: XhsApiRawSummary | null,
  context: XhsRequestAuditContext | undefined,
  errorMessage?: string,
  durationMs?: number,
): Promise<void> {
  if (!context?.userId) return
  await writeOperationLog({
    userId: context.userId,
    username: context.username ?? null,
    role: context.role ?? null,
    action,
    module: 'xhs_export',
    description: errorMessage
      ? `小红书接口 ${apiKey} 失败：${errorMessage.slice(0, 120)}`
      : `小红书接口 ${apiKey} 成功`,
    requestId: context.requestId ?? null,
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null,
    meta: {
      apiKey,
      method: def.method,
      urlPath: urlPath(def.url),
      code: summary?.code ?? null,
      success: summary?.success ?? null,
      msg: summary?.msg ? String(summary.msg).slice(0, 200) : null,
      itemCount: summary?.itemCount ?? null,
      durationMs: durationMs ?? null,
      errorMessage: errorMessage?.slice(0, 300) ?? null,
    },
  })
}

export interface RequestXhsApiParams {
  apiKey: XhsApiKey
  body?: unknown
  query?: Record<string, string>
  refererOverride?: string
  context?: XhsRequestAuditContext
  liveAccountId?: string
  liveAccountName?: string
  accountIndex?: number
  accountTotal?: number
  cmdLog?: {
    apiLabel: string
    pageNo?: number
    dateRange?: string
  }
}

export async function requestXhsApi<T = unknown>(
  params: RequestXhsApiParams,
): Promise<XhsApiRequestResult<T>> {
  const def = getApiDefinition(params.apiKey)

  if (!isApiConfigured(params.apiKey)) {
    return {
      ok: false,
      data: null,
      rawSummary: null,
      errorMessage: XHS_API_NOT_CONFIGURED_MSG,
    }
  }

  let url = def.url
  if (params.query) {
    const u = new URL(url)
    for (const [k, v] of Object.entries(params.query)) {
      u.searchParams.set(k, v)
    }
    url = u.toString()
  }

  return enqueueXhsRequest(async () => {
    const started = Date.now()
    const accountName = params.liveAccountName ?? '默认账号'

    async function resolveCookie(): Promise<string | null> {
      if (params.liveAccountId) {
        return getDecryptedCookieByAccountId(params.liveAccountId)
      }
      try {
        return await getDecryptedCookie()
      } catch {
        return null
      }
    }

    async function executeOnce(cookie: string): Promise<XhsApiRequestResult<T>> {
      try {
        const data = await requestXhsJson<T>({
          method: def.method,
          url,
          body: params.body,
          cookie,
          referer: params.refererOverride ?? def.referer,
          needSign: def.needSign,
          audit: params.context ? { ...params.context, module: 'xhs_export' } : undefined,
          apiKey: params.apiKey,
          signLogContext: params.liveAccountId
            ? { tag: 'xhs-sign', accountName, liveAccountId: params.liveAccountId }
            : undefined,
          cmdLog: params.cmdLog
            ? {
                accountName,
                liveAccountId: params.liveAccountId,
                accountIndex: params.accountIndex,
                accountTotal: params.accountTotal,
                apiLabel: params.cmdLog.apiLabel,
                pageNo: params.cmdLog.pageNo,
                dateRange: params.cmdLog.dateRange,
              }
            : params.liveAccountName
              ? {
                  accountName,
                  liveAccountId: params.liveAccountId,
                  accountIndex: params.accountIndex,
                  accountTotal: params.accountTotal,
                  apiLabel: params.apiKey,
                }
              : undefined,
        })
        const rawSummary = buildRawSummary(data)
        const durationMs = Date.now() - started
        await logApiRequest(
          'api_request_success',
          params.apiKey,
          def,
          rawSummary,
          params.context,
          undefined,
          durationMs,
        )
        return { ok: true, data, rawSummary, errorMessage: null, authError: null }
      } catch (err) {
        const message = err instanceof Error ? err.message : '请求失败'
        const durationMs = Date.now() - started
        await logApiRequest(
          'api_request_failed',
          params.apiKey,
          def,
          null,
          params.context,
          message,
          durationMs,
        )
        if (err instanceof XhsAuthError) {
          return {
            ok: false,
            data: null,
            rawSummary: null,
            errorMessage: message,
            httpStatus: err.httpStatus,
            authError: {
              kind: err.kind,
              cookieStatus: err.cookieStatus,
              apiKey: params.apiKey,
              stopRound: err.stopRound,
            },
          }
        }
        const classified = classifyXhsErrorMessage(message)
        if (classified.expired || classified.suspected) {
          return {
            ok: false,
            data: null,
            rawSummary: null,
            errorMessage: message,
            authError: {
              kind: classified.errorCode ?? 'auth_expired',
              cookieStatus: classified.cookieStatus ?? 'invalid',
              apiKey: params.apiKey,
            },
          }
        }
        return { ok: false, data: null, rawSummary: null, errorMessage: message, authError: null }
      }
    }

    let cookie = await resolveCookie()
    if (!cookie) {
      return {
        ok: false,
        data: null,
        rawSummary: null,
        errorMessage: '尚未配置 Cookie',
        authError: null,
      }
    }

    let result = await executeOnce(cookie)

    if (result.authError && params.liveAccountId && accountName) {
      const {
        refreshShopCookieFromControl,
        resolveLocalFallbackCookie,
      } = await import('../qianfan-cookie-resolver.service')

      const refreshed = await refreshShopCookieFromControl(accountName)
      if (refreshed && refreshed !== cookie) {
        cookie = refreshed
        result = await executeOnce(cookie)
      }

      if (result.authError) {
        const localFallback = await resolveLocalFallbackCookie(params.liveAccountId, accountName)
        if (localFallback && localFallback !== cookie) {
          result = await executeOnce(localFallback)
        }
      }
    }

    return result
  })
}
