import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  fetchAllGoodReviews,
  fetchReviewCountDetail,
  fetchReviewOverview,
  fetchShopScore,
} from './good-review-api.service'
import {
  mergeShopStats,
  parseReviewCountDetail,
  parseReviewOverview,
  parseShopScore,
} from './good-review-normalize.service'
import { saveGoodReviewShopStats, saveGoodReviews } from './good-review-store.service'
import type { GoodReviewSyncShopResult, NormalizedGoodReviewShopStats } from './good-review.types'

function formatSettledError(result: PromiseRejectedResult): string {
  const reason = result.reason
  return reason instanceof Error ? reason.message : String(reason)
}

export async function syncGoodReviewsForShop(
  shop: GoodReviewShopDefinition,
  options?: { days?: number },
): Promise<GoodReviewSyncShopResult> {
  const syncedAt = new Date()
  const partialErrors: string[] = []

  const [scoreResult, countResult, overviewResult] = await Promise.allSettled([
    fetchShopScore(shop),
    fetchReviewCountDetail(shop),
    fetchReviewOverview(shop),
  ])

  const shopScoreSuccess = scoreResult.status === 'fulfilled'
  const countSuccess = countResult.status === 'fulfilled'
  const overviewSuccess = overviewResult.status === 'fulfilled'

  let scorePart = { shopScore: null as number | null, raw: null as Record<string, unknown> | null }
  if (shopScoreSuccess) {
    scorePart = parseShopScore(scoreResult.value)
  } else {
    partialErrors.push(`店铺评分: ${formatSettledError(scoreResult)}`)
  }

  const statsParts: Array<Partial<NormalizedGoodReviewShopStats>> = [
    { shopScore: scorePart.shopScore, scoreRaw: scorePart.raw },
  ]

  if (countSuccess) {
    statsParts.push(parseReviewCountDetail(countResult.value))
  } else {
    partialErrors.push(`评价统计: ${formatSettledError(countResult)}`)
  }

  if (overviewSuccess) {
    statsParts.push(parseReviewOverview(overviewResult.value))
  } else {
    partialErrors.push(`评价概览: ${formatSettledError(overviewResult)}`)
  }

  let reviewPayload: Awaited<ReturnType<typeof fetchAllGoodReviews>> = {
    reviews: [],
    totalReviewCount: null,
    fetchedReviewCount: 0,
    syncedReviewCount: 0,
    truncated: false,
    managerEnvelope: null,
  }
  let managerError: string | undefined
  try {
    reviewPayload = await fetchAllGoodReviews(shop, { days: options?.days })
  } catch (err) {
    managerError = err instanceof Error ? err.message : String(err)
    partialErrors.push(`好评列表: ${managerError}`)
  }

  const env = reviewPayload.managerEnvelope
  const managerSyncedCount = reviewPayload.reviews.length
  let managerSuccess = managerSyncedCount > 0
  if (!managerSuccess && env) {
    if (env.success && env.listCount > 0) managerSuccess = true
    else if (env.success && env.total != null && env.total > 0 && managerSyncedCount === 0) {
      managerError = managerError ?? `接口返回 total=${env.total} 但解析明细为 0 条`
    } else if (!env.success) {
      managerError =
        managerError ??
        `review_manager 失败：${env.platformMsg ?? '未知'}（code=${env.platformCode ?? 'n/a'}）`
    }
  } else if (!managerSuccess && managerSyncedCount === 0 && !managerError) {
    managerError = 'review_manager 未返回评价明细'
  }

  const statsApiOk = shopScoreSuccess || countSuccess || overviewSuccess

  if (!statsApiOk && managerSyncedCount === 0) {
    return {
      shopKey: shop.shopKey,
      shopName: shop.shopName,
      success: false,
      shopScoreSuccess,
      countSuccess,
      overviewSuccess,
      managerSuccess: false,
      managerSyncedCount: 0,
      managerError,
      platformCode: env?.platformCode ?? undefined,
      platformMsg: env?.platformMsg ?? undefined,
      error: partialErrors.join('；') || '同步失败',
    }
  }

  const stats: NormalizedGoodReviewShopStats = mergeShopStats(shop.shopKey, shop.shopName, statsParts)

  if (reviewPayload.totalReviewCount != null && reviewPayload.totalReviewCount > 0) {
    stats.totalReviewCount = Math.max(stats.totalReviewCount, reviewPayload.totalReviewCount)
  }
  if (managerSyncedCount > 0) {
    stats.goodReviewCount = Math.max(stats.goodReviewCount, managerSyncedCount)
  }

  await saveGoodReviewShopStats(stats, syncedAt)
  if (managerSyncedCount > 0) {
    await saveGoodReviews(reviewPayload.reviews, syncedAt)
  }

  const latest = reviewPayload.reviews
    .map((r) => r.reviewTime ?? (r.reviewTimeText ? new Date(r.reviewTimeText) : null))
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0]

  if (stats.goodReviewCount > 0 && managerSyncedCount === 0) {
    partialErrors.push(`统计已同步（${stats.goodReviewCount} 条好评），明细同步失败：${managerError ?? '未知原因'}`)
  }

  if (reviewPayload.truncated && reviewPayload.warning) {
    partialErrors.push(reviewPayload.warning)
  }

  return {
    shopKey: shop.shopKey,
    shopName: shop.shopName,
    success: true,
    syncedReviewCount: managerSyncedCount,
    fetchedReviewCount: reviewPayload.fetchedReviewCount,
    totalReviewCount: stats.goodReviewCount || stats.totalReviewCount,
    truncated: reviewPayload.truncated,
    warning: reviewPayload.warning,
    latestReviewTime: latest?.toISOString(),
    shopScoreSuccess,
    countSuccess,
    overviewSuccess,
    managerSuccess,
    managerSyncedCount,
    managerError,
    platformCode: env?.platformCode ?? undefined,
    platformMsg: env?.platformMsg ?? undefined,
    error: partialErrors.length > 0 ? partialErrors.join('；') : undefined,
  }
}
