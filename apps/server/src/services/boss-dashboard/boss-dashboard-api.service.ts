import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  BOSS_FINANCE_API,
  BOSS_FINANCE_REFERER,
  BOSS_SCORE_API,
  BOSS_SCORE_REFERER,
} from '../../config/boss-dashboard.constants'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import { resolveLiveAccountCookie } from '../qianfan-cookie-resolver.service'
import { requestXhsJsonWithSyncAudit } from '../sync-request-audit.service'
import { enqueueXhsRequest } from '../xhs-api-sync/xhs-rate-limiter.service'

async function resolveAccountId(shop: GoodReviewShopDefinition): Promise<string> {
  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) throw new Error(`店铺 ${shop.shopName} 尚未配置官方账号`)
  return account.id
}

async function bossRequest<T>(params: {
  shop: GoodReviewShopDefinition
  apiName: string
  method: 'GET' | 'POST'
  url: string
  body?: Record<string, unknown>
  referer: string
}): Promise<T> {
  return enqueueXhsRequest(async () => {
    const accountId = await resolveAccountId(params.shop)
    const cookie = await resolveLiveAccountCookie(accountId, params.shop.shopName)
    if (!cookie) throw new Error(`店铺 ${params.shop.shopName} Cookie 不可用`)
    return requestXhsJsonWithSyncAudit<T>({
      shopId: accountId,
      shopName: params.shop.shopName,
      apiName: params.apiName,
      method: params.method,
      urlKey: params.url.split('?')[0]!.slice(-96),
      trigger: 'scheduled',
      options: {
        method: params.method,
        url: params.url,
        body: params.body,
        cookie,
        referer: params.referer,
        needSign: true,
        signLogContext: {
          tag: 'xhs-sign',
          accountName: params.shop.shopName,
          liveAccountId: accountId,
        },
        cmdLog: {
          accountName: params.shop.shopName,
          liveAccountId: accountId,
          apiLabel: params.apiName,
        },
      },
    })
  })
}

export function fetchBossAggregateAccount(shop: GoodReviewShopDefinition) {
  return bossRequest<unknown>({
    shop,
    apiName: 'boss_account_summary',
    method: 'GET',
    url: BOSS_FINANCE_API.aggregateAccount,
    referer: BOSS_FINANCE_REFERER,
  })
}

export function fetchBossAfterSaleFrozen(shop: GoodReviewShopDefinition) {
  return bossRequest<unknown>({
    shop,
    apiName: 'boss_account_summary',
    method: 'GET',
    url: BOSS_FINANCE_API.afterSaleFrozen,
    referer: BOSS_FINANCE_REFERER,
  })
}

export function fetchBossCanWithdraw(shop: GoodReviewShopDefinition) {
  return bossRequest<unknown>({
    shop,
    apiName: 'boss_account_summary',
    method: 'POST',
    url: BOSS_FINANCE_API.canWithdraw,
    body: {},
    referer: BOSS_FINANCE_REFERER,
  })
}

export function fetchBossAccountRecordPage(
  shop: GoodReviewShopDefinition,
  pageNum: number,
  pageSize: number,
) {
  return bossRequest<unknown>({
    shop,
    apiName: 'boss_account_flow',
    method: 'POST',
    url: BOSS_FINANCE_API.listAccountRecord,
    body: { pageNum, pageSize },
    referer: BOSS_FINANCE_REFERER,
  })
}

export function fetchBossShopScore(shop: GoodReviewShopDefinition) {
  return bossRequest<unknown>({
    shop,
    apiName: 'boss_shop_score',
    method: 'POST',
    url: BOSS_SCORE_API.shopScore,
    body: { source: 'PC' },
    referer: BOSS_SCORE_REFERER,
  })
}

export function fetchBossShopScoreTrend(
  shop: GoodReviewShopDefinition,
  label: string,
  nDayRecent: number,
) {
  return bossRequest<unknown>({
    shop,
    apiName: 'boss_shop_score',
    method: 'POST',
    url: BOSS_SCORE_API.scoreTrend,
    body: { nDayRecent, labels: label },
    referer: BOSS_SCORE_REFERER,
  })
}
