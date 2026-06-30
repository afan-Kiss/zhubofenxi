import {
  listGoodReviewShopTargets,
  type GoodReviewShopDefinition,
} from '../../config/good-review-shops.constants'
import { syncGoodReviewsForShop } from './good-review-shop-sync.service'
import { touchGoodReviewSyncMeta } from './good-review-store.service'
import type { GoodReviewSyncResult } from './good-review.types'

export async function syncGoodReviews(params?: { shop?: string }): Promise<GoodReviewSyncResult> {
  const startedAt = new Date()
  const targets = listGoodReviewShopTargets(params?.shop ?? 'all')

  if (targets.length === 0) {
    const finishedAt = new Date()
    return {
      ok: false,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      totalShopCount: 0,
      successShopCount: 0,
      failedShopCount: 0,
      shops: [],
    }
  }

  const settled = await Promise.all(
    targets.map((shop: GoodReviewShopDefinition) => syncGoodReviewsForShop(shop)),
  )

  const successShopCount = settled.filter((s) => s.success).length
  const failedShopCount = settled.length - successShopCount
  const finishedAt = new Date()

  if (successShopCount > 0) {
    await touchGoodReviewSyncMeta(finishedAt)
  }

  return {
    ok: successShopCount > 0,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalShopCount: settled.length,
    successShopCount,
    failedShopCount,
    shops: settled,
  }
}
