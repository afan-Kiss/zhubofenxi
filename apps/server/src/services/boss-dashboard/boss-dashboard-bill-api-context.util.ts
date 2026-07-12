import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import { resolveLiveAccountCookie } from '../qianfan-cookie-resolver.service'
import { buildBossCooldownScopeKey } from '../sync-request-audit.service'

export type BossRequestParams = {
  shop: GoodReviewShopDefinition
  apiName: string
  method: 'GET' | 'POST'
  url: string
  body?: Record<string, unknown>
  referer: string
  pageNo?: number
}

export async function buildBossRequestContext(shop: GoodReviewShopDefinition, apiName: string) {
  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) throw new Error(`店铺 ${shop.shopName} 尚未配置官方账号`)
  const cookie = await resolveLiveAccountCookie(account.id, shop.shopName)
  if (!cookie) throw new Error(`店铺 ${shop.shopName} Cookie 不可用`)
  const cooldownScopeKey = buildBossCooldownScopeKey(shop.shopKey, account.id)
  return { accountId: account.id, cookie, cooldownScopeKey, apiName }
}
