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
  const daysWindow = options?.days != null && options.days > 0
  let managerSuccess = managerSyncedCount > 0 || Boolean(env?.success)
  let managerErrorFinal = managerError
  if (!managerSyncedCount && env) {
    if (env.success) {
      // days 窗口内本来就没有新评价：不算明细失败（total 多为全量累计）
      if (!daysWindow && env.total != null && env.total > 0) {
        managerErrorFinal =
          managerErrorFinal ?? `接口返回 total=${env.total} 但解析明细为 0 条`
        managerSuccess = false
      }
    } else {
      managerSuccess = false
      managerErrorFinal =
        managerErrorFinal ??
        `review_manager 失败：${env.platformMsg ?? '未知'}（code=${env.platformCode ?? 'n/a'}）`
    }
  } else if (!managerSyncedCount && !env && !managerErrorFinal && !daysWindow) {
    managerErrorFinal = 'review_manager 未返回评价明细'
    managerSuccess = false
  }

  const statsApiOk = shopScoreSuccess || countSuccess || overviewSuccess

  if (!statsApiOk && managerSyncedCount === 0 && !managerSuccess) {
    return {
      shopKey: shop.shopKey,
      shopName: shop.shopName,
      success: false,
      shopScoreSuccess,
      countSuccess,
      overviewSuccess,
      managerSuccess: false,
      managerSyncedCount: 0,
      managerError: managerErrorFinal,
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

  // 仅在列表接口真正失败时提示；近 N 天窗口为空属于正常
  if (!managerSuccess && managerErrorFinal) {
    partialErrors.push(`好评明细同步失败：${managerErrorFinal}`)
  } else if (!daysWindow && stats.goodReviewCount > 0 && managerSyncedCount === 0 && managerErrorFinal) {
    partialErrors.push(`统计已同步（${stats.goodReviewCount} 条好评），明细同步失败：${managerErrorFinal}`)
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
    managerError: managerErrorFinal,
    platformCode: env?.platformCode ?? undefined,
    platformMsg: env?.platformMsg ?? undefined,
    error: partialErrors.length > 0 ? partialErrors.join('；') : undefined,
  }
}
