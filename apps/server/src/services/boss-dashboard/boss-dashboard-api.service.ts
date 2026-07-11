import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  BOSS_FINANCE_API,
  BOSS_FINANCE_REFERER,
  BOSS_SCORE_API,
  BOSS_SCORE_REFERER,
} from '../../config/boss-dashboard.constants'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import { resolveLiveAccountCookie } from '../qianfan-cookie-resolver.service'
import {
  buildBossCooldownScopeKey,
  buildBossRequestHash,
  requestXhsJsonWithSyncAudit,
  runXhsRequestWithAuditAndThrottle,
  type XhsAuditedRequestResult,
} from '../sync-request-audit.service'
import { enqueueXhsRequest } from '../xhs-api-sync/xhs-rate-limiter.service'
import { shouldBypassBossShopScoreCooldown } from './boss-dashboard-score-cooldown.util'
import { prisma } from '../../lib/prisma'
import { formatDateKeyShanghai } from '../../utils/business-timezone'
import { requestXhsJson } from '../xhs-http.service'

async function resolveShopScoreCooldownOverride(
  shop: GoodReviewShopDefinition,
  apiName: string,
): Promise<number | undefined> {
  if (apiName !== 'boss_shop_score') return undefined
  const todayKey = formatDateKeyShanghai()
  const existingToday = await prisma.bossShopScoreSnapshot.findUnique({
    where: { shopKey_scoreDate: { shopKey: shop.shopKey, scoreDate: todayKey } },
    select: {
      fetchedAt: true,
      qualityScore: true,
      logisticsScore: true,
      serviceScore: true,
      sourceApi: true,
    },
  })
  const complete =
    existingToday != null &&
    existingToday.qualityScore != null &&
    existingToday.logisticsScore != null &&
    existingToday.serviceScore != null &&
    existingToday.sourceApi !== 'boss_shop_score:partial'
  if (existingToday?.fetchedAt && complete) return undefined
  if (!shouldBypassBossShopScoreCooldown(shop.shopKey)) return undefined
  return 0
}

async function resolveAccountId(shop: GoodReviewShopDefinition): Promise<string> {
  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) throw new Error(`店铺 ${shop.shopName} 尚未配置官方账号`)
  return account.id
}

type BossRequestParams = {
  shop: GoodReviewShopDefinition
  apiName: string
  method: 'GET' | 'POST'
  url: string
  body?: Record<string, unknown>
  referer: string
  pageNo?: number
}

async function buildBossRequestContext(shop: GoodReviewShopDefinition, apiName: string) {
  const accountId = await resolveAccountId(shop)
  const cookie = await resolveLiveAccountCookie(accountId, shop.shopName)
  if (!cookie) throw new Error(`店铺 ${shop.shopName} Cookie 不可用`)
  const cooldownScopeKey = buildBossCooldownScopeKey(shop.shopKey, accountId)
  const cooldownOverrideMs = await resolveShopScoreCooldownOverride(shop, apiName)
  return { accountId, cookie, cooldownScopeKey, cooldownOverrideMs }
}

function buildHashForBoss(
  shop: GoodReviewShopDefinition,
  accountId: string,
  params: Pick<BossRequestParams, 'apiName' | 'method' | 'url' | 'body'>,
) {
  return buildBossRequestHash({
    apiName: params.apiName,
    shopKey: shop.shopKey,
    credentialId: accountId,
    method: params.method,
    url: params.url,
    body: params.body,
  })
}

async function bossRequest<T>(params: BossRequestParams): Promise<T> {
  const result = await bossRequestAudited<T>(params)
  if (!result.ok || result.data == null) {
    throw new Error(result.errorMessage ?? '小红书接口请求失败')
  }
  return result.data
}

export async function bossRequestAudited<T>(
  params: BossRequestParams,
): Promise<XhsAuditedRequestResult<T>> {
  return enqueueXhsRequest(async () => {
    const ctx = await buildBossRequestContext(params.shop, params.apiName)
    const requestHash = buildHashForBoss(params.shop, ctx.accountId, params)
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
      cooldownOverrideMs: ctx.cooldownOverrideMs,
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

/** 部署诊断：计算四店账户汇总冷却 hash 前缀（不含 Cookie） */
export async function previewBossAggregateRequestHash(
  shop: GoodReviewShopDefinition,
): Promise<{ shopKey: string; scopeKey: string; hash: string } | null> {
  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) return null
  const scopeKey = buildBossCooldownScopeKey(shop.shopKey, account.id)
  const hash = buildBossRequestHash({
    apiName: 'boss_account_summary',
    shopKey: shop.shopKey,
    credentialId: account.id,
    method: 'GET',
    url: BOSS_FINANCE_API.aggregateAccount,
  })
  return { shopKey: shop.shopKey, scopeKey, hash }
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

export function fetchBossAggregateAccountAudited(shop: GoodReviewShopDefinition) {
  return bossRequestAudited<unknown>({
    shop,
    apiName: 'boss_account_summary',
    method: 'GET',
    url: BOSS_FINANCE_API.aggregateAccount,
    referer: BOSS_FINANCE_REFERER,
  })
}

export function fetchBossAfterSaleFrozenAudited(shop: GoodReviewShopDefinition) {
  return bossRequestAudited<unknown>({
    shop,
    apiName: 'boss_after_sale_frozen',
    method: 'GET',
    url: BOSS_FINANCE_API.afterSaleFrozen,
    referer: BOSS_FINANCE_REFERER,
  })
}

export function fetchBossCanWithdrawAudited(shop: GoodReviewShopDefinition) {
  return bossRequestAudited<unknown>({
    shop,
    apiName: 'boss_withdraw_flow',
    method: 'POST',
    url: BOSS_FINANCE_API.canWithdraw,
    body: {},
    referer: BOSS_FINANCE_REFERER,
  })
}

export function fetchBossAfterSaleFrozen(shop: GoodReviewShopDefinition) {
  return bossRequest<unknown>({
    shop,
    apiName: 'boss_after_sale_frozen',
    method: 'GET',
    url: BOSS_FINANCE_API.afterSaleFrozen,
    referer: BOSS_FINANCE_REFERER,
  })
}

export function fetchBossCanWithdraw(shop: GoodReviewShopDefinition) {
  return bossRequest<unknown>({
    shop,
    apiName: 'boss_withdraw_flow',
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
    pageNo: pageNum,
  })
}

export function fetchBossShopScoreAudited(shop: GoodReviewShopDefinition) {
  return bossRequestAudited<unknown>({
    shop,
    apiName: 'boss_shop_score',
    method: 'POST',
    url: BOSS_SCORE_API.shopScore,
    body: { source: 'PC' },
    referer: BOSS_SCORE_REFERER,
  })
}

export function fetchBossShopScoreTrendAudited(
  shop: GoodReviewShopDefinition,
  label: string,
  nDayRecent: number,
) {
  return bossRequestAudited<unknown>({
    shop,
    apiName: 'boss_shop_score',
    method: 'POST',
    url: BOSS_SCORE_API.scoreTrend,
    body: { nDayRecent, labels: label },
    referer: BOSS_SCORE_REFERER,
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
