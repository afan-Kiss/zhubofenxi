/**
 * 售后 HTTP 依赖注入（默认生产实现；测试可替换，不改变业务接口）
 */
import { requestXhsJsonWithSyncAudit } from './sync-request-audit.service'
import { enqueueXhsRequest } from './xhs-api-sync/xhs-rate-limiter.service'
import { getDecryptedCookieByAccountId } from './live-account.service'
import { getDecryptedCookie } from './credential.service'
import { waitShopPlatformSlot } from './after-sales-shop-rate.service'

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

export type AfterSalesHttpExecutor = (params: AfterSalesHttpCallParams) => Promise<unknown>

export type AfterSalesCookieProvider = (liveAccountId: string) => Promise<string>

export type AfterSalesRateWait = (liveAccountId: string) => Promise<void>

export interface AfterSalesHttpDeps {
  httpExecutor: AfterSalesHttpExecutor
  cookieProvider: AfterSalesCookieProvider
  waitShopSlot: AfterSalesRateWait
}

const defaultHttpExecutor: AfterSalesHttpExecutor = async (params) => {
  return enqueueXhsRequest(() =>
    requestXhsJsonWithSyncAudit<unknown>({
      shopId: params.liveAccountId,
      apiName: params.apiName,
      method: params.method ?? 'GET',
      urlKey: params.urlKey,
      trigger: 'scheduled',
      options: {
        method: params.method ?? 'GET',
        url: params.url,
        cookie: params.cookie,
        referer: params.referer,
        body: params.body,
        needSign: true,
        parseEnvelope: true,
      },
    }),
  )
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
