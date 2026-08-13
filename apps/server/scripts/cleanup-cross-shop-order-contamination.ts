/**
 * 清理串店写入：删除 sellerId 归属他店、却挂在本店 liveAccountId 下的 XhsRawOrder。
 * 覆盖 packageId 有值 与 packageId 为空但 orderId 有值 的历史行。
 * 默认 dry-run；传 --apply 才删除，并失效经营看板缓存。
 *
 * 例：
 *   npx tsx apps/server/scripts/cleanup-cross-shop-order-contamination.ts
 *   npx tsx apps/server/scripts/cleanup-cross-shop-order-contamination.ts --apply
 */
import { prisma } from '../src/lib/prisma'
import {
  OFFICIAL_SHOP_SELLER_IDS,
  type GoodReviewShopKey,
} from '../src/config/good-review-shops.constants'
import {
  extractSellerIdFromOrderRaw,
  resolveOrderShopOwnership,
} from '../src/services/order-shop-ownership.util'
import { invalidateBusinessBoardCache, scheduleBusinessBoardCacheRebuild } from '../src/services/business-cache.service'

const APPLY = process.argv.includes('--apply')

async function main() {
  // 先摸一下连接，避免 invalidate 时 engine 未就绪
  await prisma.$queryRaw`SELECT 1`

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

  const accountIds = [...shopKeyByAccountId.keys()]
  const rows = await prisma.xhsRawOrder.findMany({
    where: {
      liveAccountId: { in: accountIds },
      OR: [{ packageId: { not: null } }, { orderId: { not: null } }],
    },
    select: {
      id: true,
      packageId: true,
      orderId: true,
      liveAccountId: true,
      liveAccountName: true,
      rawJson: true,
    },
  })

  const toDelete: Array<{
    id: string
    packageId: string | null
    orderId: string | null
    liveAccountId: string
    liveAccountName: string | null
    syncShopKey: GoodReviewShopKey
    ownerShopKey: GoodReviewShopKey
    sellerId: string
  }> = []

  let unknownSellerIdCount = 0
  let unknownSyncShopCount = 0

  for (const row of rows) {
    const syncShopKey = shopKeyByAccountId.get(row.liveAccountId) ?? null
    const raw =
      row.rawJson && typeof row.rawJson === 'object' && !Array.isArray(row.rawJson)
        ? (row.rawJson as Record<string, unknown>)
        : null
    const sellerId = extractSellerIdFromOrderRaw(raw)
    const verdict = resolveOrderShopOwnership({
      sellerId,
      liveAccountName: row.liveAccountName,
      platformName: syncShopKey,
      raw,
    })
    if (verdict.status === 'unknown_seller') unknownSellerIdCount++
    if (verdict.status === 'unknown_sync_shop') unknownSyncShopCount++
    if (verdict.status !== 'mismatch' || !verdict.ownerShopKey || !verdict.syncShopKey) continue
    toDelete.push({
      id: row.id,
      packageId: row.packageId,
      orderId: row.orderId,
      liveAccountId: row.liveAccountId,
      liveAccountName: row.liveAccountName,
      syncShopKey: verdict.syncShopKey,
      ownerShopKey: verdict.ownerShopKey,
      sellerId: verdict.sellerId,
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
        deleted: APPLY ? undefined : 0,
        unknownSellerIdCount,
        unknownSyncShopCount,
        byPair: Object.fromEntries(byPair),
        samples: toDelete.slice(0, 8).map((d) => ({
          packageId: d.packageId,
          orderId: d.orderId,
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
  scheduleBusinessBoardCacheRebuild('cleanup-cross-shop-order-contamination')
  console.log(
    JSON.stringify(
      {
        apply: true,
        scanned: rows.length,
        contaminated: toDelete.length,
        deleted,
        unknownSellerIdCount,
        unknownSyncShopCount,
        byPair: Object.fromEntries(byPair),
        boardCacheInvalidated: true,
        boardCacheRebuildScheduled: true,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
