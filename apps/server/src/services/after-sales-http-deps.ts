/**
 * 售后 HTTP 依赖注入：返回是否真实发网
 */
import {
  buildXhsRequestHash,
  runXhsRequestWithAuditAndThrottle,
} from './sync-request-audit.service'
import { enqueueXhsRequest } from './xhs-api-sync/xhs-rate-limiter.service'
import { getDecryptedCookieByAccountId } from './live-account.service'
import { getDecryptedCookie } from './credential.service'
import { waitShopPlatformSlot } from './after-sales-shop-rate.service'
import { requestXhsJson } from './xhs-http.service'
import { AfterSalesRequestError, classifyThrownHttpCause } from './after-sales-request-error'

export type AfterSalesHttpCallParams = {
  url: string
  cookie: string
  liveAccountId?: string
  method?: 'GET' | 'POST'
  body?: unknown
  apiName: string
  urlKey: string
  referer: string
}

export type AfterSalesHttpDecision =
  | 'network_success'
  | 'network_failed'
  | 'local_throttled'
  | 'local_circuit_open'

export type AfterSalesHttpExecutionResult = {
  payload: unknown
  networkSent: boolean
  decision: AfterSalesHttpDecision
  httpStatus?: number
}

export type AfterSalesHttpExecutor = (
  params: AfterSalesHttpCallParams,
) => Promise<AfterSalesHttpExecutionResult>

export type AfterSalesCookieProvider = (liveAccountId: string) => Promise<string>

export type AfterSalesRateWait = (liveAccountId: string) => Promise<void>

export interface AfterSalesHttpDeps {
  httpExecutor: AfterSalesHttpExecutor
  cookieProvider: AfterSalesCookieProvider
  waitShopSlot: AfterSalesRateWait
}

const defaultHttpExecutor: AfterSalesHttpExecutor = async (params) => {
  const method = params.method ?? 'GET'
  const requestHash = buildXhsRequestHash({
    apiName: params.apiName,
    body: params.body,
    url: params.url,
  })

  const audited = await enqueueXhsRequest(() =>
    runXhsRequestWithAuditAndThrottle<unknown>({
      shopId: params.liveAccountId,
      apiName: params.apiName,
      method,
      urlKey: params.urlKey,
      requestHash,
      trigger: 'scheduled',
      execute: async () => {
        try {
          const data = await requestXhsJson<unknown>({
            method,
            url: params.url,
            cookie: params.cookie,
            referer: params.referer,
            body: params.body,
            needSign: true,
            parseEnvelope: true,
          })
          return { ok: true, data, errorMessage: null }
        } catch (err) {
          return {
            ok: false,
            data: null,
            errorMessage: err instanceof Error ? err.message : String(err),
          }
        }
      },
    }),
  )

  if (!audited.ok) {
    const msg = audited.errorMessage ?? '小红书接口请求失败'
    const decision: AfterSalesHttpDecision = audited.skippedRemote
      ? audited.auditStatus === 'circuit_open'
        ? 'local_circuit_open'
        : 'local_throttled'
      : 'network_failed'
    const networkSent = !audited.skippedRemote
    throw new AfterSalesRequestError({
      message: msg,
      requestAttempts: 1,
      networkRequests: networkSent ? 1 : 0,
      networkSent,
      causeCode:
        decision === 'local_throttled'
          ? 'local_throttled'
          : decision === 'local_circuit_open'
            ? 'local_circuit_open'
            : classifyThrownHttpCause(msg),
      retryable: true,
    })
  }

  return {
    payload: audited.data,
    networkSent: true,
    decision: 'network_success',
  }
}

const defaultCookieProvider: AfterSalesCookieProvider = async (liveAccountId) => {
  const id = String(liveAccountId ?? '').trim()
  if (!id || id === 'legacy') return getDecryptedCookie()
  return getDecryptedCookieByAccountId(id)
}

const defaultWaitShopSlot: AfterSalesRateWait = async (liveAccountId) => {
  await waitShopPlatformSlot(liveAccountId)
}

let override: Partial<AfterSalesHttpDeps> | null = null

export function getAfterSalesHttpDeps(): AfterSalesHttpDeps {
  return {
    httpExecutor: override?.httpExecutor ?? defaultHttpExecutor,
    cookieProvider: override?.cookieProvider ?? defaultCookieProvider,
    waitShopSlot: override?.waitShopSlot ?? defaultWaitShopSlot,
  }
}

export function setAfterSalesHttpDepsForTest(partial: Partial<AfterSalesHttpDeps> | null): void {
  override = partial
}

export function resetAfterSalesHttpDepsForTest(): void {
  override = null
}
