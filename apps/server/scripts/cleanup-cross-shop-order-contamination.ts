/**
 * 清理串店写入：删除 sellerId 归属他店、却挂在本店 liveAccountId 下的 XhsRawOrder。
 * 默认 dry-run；传 --apply 才删除，并失效经营看板缓存。
 *
 * 例：
 *   npx tsx apps/server/scripts/cleanup-cross-shop-order-contamination.ts
 *   npx tsx apps/server/scripts/cleanup-cross-shop-order-contamination.ts --apply
 */
import { prisma } from '../src/lib/prisma'
import {
  OFFICIAL_SHOP_SELLER_IDS,
  resolveGoodReviewShopKeyBySellerId,
  type GoodReviewShopKey,
} from '../src/config/good-review-shops.constants'
import { extractSellerIdFromOrderRaw } from '../src/services/order-shop-ownership.util'
import { invalidateBusinessBoardCache } from '../src/services/business-cache.service'

const APPLY = process.argv.includes('--apply')

async function main() {
  const creds = await prisma.platformCredential.findMany({
    select: { id: true, platformName: true, displayName: true },
  })
  const shopKeyByAccountId = new Map<string, GoodReviewShopKey>()
  for (const c of creds) {
    const key = c.platformName as GoodReviewShopKey
    if (key in OFFICIAL_SHOP_SELLER_IDS) {
      shopKeyByAccountId.set(c.id, key)
    }
  }

  const rows = await prisma.xhsRawOrder.findMany({
    where: {
      liveAccountId: { in: [...shopKeyByAccountId.keys()] },
      packageId: { not: null },
    },
    select: {
      id: true,
      packageId: true,
      liveAccountId: true,
      liveAccountName: true,
      rawJson: true,
    },
  })

  const toDelete: Array<{
    id: string
    packageId: string | null
    liveAccountId: string
    liveAccountName: string | null
    syncShopKey: GoodReviewShopKey
    ownerShopKey: GoodReviewShopKey
    sellerId: string
  }> = []

  for (const row of rows) {
    const syncShopKey = shopKeyByAccountId.get(row.liveAccountId)
    if (!syncShopKey) continue
    const raw =
      row.rawJson && typeof row.rawJson === 'object' && !Array.isArray(row.rawJson)
        ? (row.rawJson as Record<string, unknown>)
        : null
    const sellerId = extractSellerIdFromOrderRaw(raw)
    const ownerShopKey = resolveGoodReviewShopKeyBySellerId(sellerId)
    if (!ownerShopKey || ownerShopKey === syncShopKey) continue
    toDelete.push({
      id: row.id,
      packageId: row.packageId,
      liveAccountId: row.liveAccountId,
      liveAccountName: row.liveAccountName,
      syncShopKey,
      ownerShopKey,
      sellerId,
    })
  }

  const byPair = new Map<string, number>()
  for (const d of toDelete) {
    const k = `${d.syncShopKey}->${d.ownerShopKey}`
    byPair.set(k, (byPair.get(k) ?? 0) + 1)
  }

  console.log(
    JSON.stringify(
      {
        apply: APPLY,
        scanned: rows.length,
        contaminated: toDelete.length,
        byPair: Object.fromEntries(byPair),
        samples: toDelete.slice(0, 8).map((d) => ({
          packageId: d.packageId,
          sync: d.syncShopKey,
          owner: d.ownerShopKey,
          liveAccountName: d.liveAccountName,
        })),
      },
      null,
      2,
    ),
  )

  if (!APPLY) {
    console.log('dry-run only；加 --apply 才会删除并清看板缓存')
    return
  }

  const ids = toDelete.map((d) => d.id)
  const chunk = 200
  let deleted = 0
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk)
    const res = await prisma.xhsRawOrder.deleteMany({ where: { id: { in: part } } })
    deleted += res.count
  }
  invalidateBusinessBoardCache()
  console.log(`deleted=${deleted} boardCache invalidated`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
