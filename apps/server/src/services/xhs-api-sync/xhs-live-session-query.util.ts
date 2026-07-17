/**
 * 按店铺查询已入库直播场次：兼容官方 PlatformCredential.id
 * 与历史 LiveAccount / 显示名不一致的遗留数据。
 */
import type { Prisma } from '@prisma/client'
import type { GoodReviewShopKey } from '../../config/good-review-shops.constants'
import { getGoodReviewShopName } from '../../config/good-review-shops.constants'

/** 场次 liveAccountName 可能出现的店铺别名（含历史短名） */
export function liveAccountNameAliasesForShop(
  shopKey: GoodReviewShopKey,
  shopName?: string,
): string[] {
  const name = shopName ?? getGoodReviewShopName(shopKey)
  const aliases = new Set<string>([name, shopKey])
  if (shopKey === 'shiyuju') {
    aliases.add('拾玉居')
    aliases.add('拾玉居和田玉')
  }
  if (shopKey === 'hetianyayu') aliases.add('和田雅玉')
  if (shopKey === 'xiangyu') aliases.add('祥钰珠宝')
  if (shopKey === 'xyxiangyu') aliases.add('XY祥钰珠宝')
  return [...aliases]
}

/** 官方账号 id 或同店历史 liveAccountName 均可命中 */
export function buildShopLiveSessionWhere(params: {
  officialAccountId: string
  shopKey: GoodReviewShopKey
  shopName?: string
  startTimeGte: Date
  startTimeLte: Date
}): Prisma.XhsRawLiveSessionWhereInput {
  const names = liveAccountNameAliasesForShop(params.shopKey, params.shopName)
  return {
    AND: [
      {
        OR: [
          { liveAccountId: params.officialAccountId },
          { liveAccountName: { in: names } },
        ],
      },
      {
        startTime: {
          gte: params.startTimeGte,
          lte: params.startTimeLte,
        },
      },
    ],
  }
}
