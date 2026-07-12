import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  BOSS_BILL_API,
  BOSS_BILL_REFERER,
} from '../../config/boss-dashboard.constants'
import {
  buildBossRequestHash,
  runXhsRequestWithAuditAndThrottle,
  type XhsAuditedRequestResult,
} from '../sync-request-audit.service'
import { enqueueXhsRequest } from '../xhs-api-sync/xhs-rate-limiter.service'
import { requestXhsJson } from '../xhs-http.service'
import {
  buildBossRequestContext,
  type BossRequestParams,
} from './boss-dashboard-bill-api-context.util'

export async function bossBillRequestAudited<T>(
  params: BossRequestParams,
): Promise<XhsAuditedRequestResult<T>> {
  return enqueueXhsRequest(async () => {
    const ctx = await buildBossRequestContext(params.shop, params.apiName)
    const requestHash = buildBossRequestHash({
      apiName: params.apiName,
      shopKey: params.shop.shopKey,
      credentialId: ctx.accountId,
      method: params.method,
      url: params.url,
      body: params.body,
    })
    return runXhsRequestWithAuditAndThrottle<T>({
      shopId: ctx.accountId,
      shopName: params.shop.shopName,
      apiName: params.apiName,
      method: params.method,
      urlKey: params.url.split('?')[0]!.slice(-96),
      requestHash,
      cooldownScopeKey: ctx.cooldownScopeKey,
      trigger: 'scheduled',
      pageNo: params.pageNo,
      execute: async () => {
        try {
          const data = await requestXhsJson<T>({
            method: params.method,
            url: params.url,
            body: params.body,
            cookie: ctx.cookie,
            referer: params.referer,
            needSign: true,
            signLogContext: {
              tag: 'xhs-sign',
              accountName: params.shop.shopName,
              liveAccountId: ctx.accountId,
            },
            cmdLog: {
              accountName: params.shop.shopName,
              liveAccountId: ctx.accountId,
              apiLabel: params.apiName,
            },
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
    })
  })
}

export function fetchBossBillStoreInfoAudited(shop: GoodReviewShopDefinition) {
  return bossBillRequestAudited<unknown>({
    shop,
    apiName: 'boss_bill_store_info',
    method: 'POST',
    url: BOSS_BILL_API.storeInfo,
    body: {},
    referer: BOSS_BILL_REFERER,
  })
}

export function fetchBossSellerPreIncomeAudited(
  shop: GoodReviewShopDefinition,
  body: Record<string, unknown>,
) {
  return bossBillRequestAudited<unknown>({
    shop,
    apiName: 'boss_pending_settlement_summary',
    method: 'POST',
    url: BOSS_BILL_API.sellerPreIncome,
    body,
    referer: BOSS_BILL_REFERER,
  })
}

export function fetchBossSettleBillListAudited(
  shop: GoodReviewShopDefinition,
  body: Record<string, unknown>,
  pageNum: number,
) {
  return bossBillRequestAudited<unknown>({
    shop,
    apiName: 'boss_pending_settlement_list',
    method: 'POST',
    url: BOSS_BILL_API.settleBillList,
    body,
    referer: BOSS_BILL_REFERER,
    pageNo: pageNum,
  })
}

export function fetchBossPeriodSettleBillListAudited(
  shop: GoodReviewShopDefinition,
  body: Record<string, unknown>,
  pageNum: number,
  apiName: 'boss_settlement_bill_day' | 'boss_settlement_bill_month',
) {
  return bossBillRequestAudited<unknown>({
    shop,
    apiName,
    method: 'POST',
    url: BOSS_BILL_API.periodSettleBillList,
    body,
    referer: BOSS_BILL_REFERER,
    pageNo: pageNum,
  })
}

export function fetchBossPeriodFundBillListAudited(
  shop: GoodReviewShopDefinition,
  body: Record<string, unknown>,
  pageNum: number,
) {
  return bossBillRequestAudited<unknown>({
    shop,
    apiName: 'boss_fund_bill_reconcile',
    method: 'POST',
    url: BOSS_BILL_API.periodFundBillList,
    body,
    referer: BOSS_BILL_REFERER,
    pageNo: pageNum,
  })
}
