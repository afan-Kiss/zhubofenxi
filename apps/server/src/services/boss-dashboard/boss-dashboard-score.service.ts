import { prisma } from '../../lib/prisma'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  BOSS_SCORE_SYNC_AFTER_HM,
  BOSS_SCORE_TREND_DAYS,
  BOSS_SCORE_TREND_LABELS,
} from '../../config/boss-dashboard.constants'
import { formatDateKeyShanghai } from '../../utils/business-timezone'
import {
  fetchBossShopScore,
  fetchBossShopScoreTrend,
} from './boss-dashboard-api.service'
import {
  parseBossScoreTrend,
  parseBossShopScore,
} from './boss-dashboard-normalize.service'
import { createScoreChangeAnnouncements } from './boss-dashboard-announcement.service'
import { logInfo } from '../../utils/server-log'

function shanghaiHmNow(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${h}:${m}`
}

export function shouldFetchShopScoreToday(): boolean {
  const hm = shanghaiHmNow()
  return hm >= BOSS_SCORE_SYNC_AFTER_HM
}

async function loadTrendScores(
  shop: GoodReviewShopDefinition,
  label: string,
): Promise<Array<{ date: string; score: number }>> {
  const payload = await fetchBossShopScoreTrend(shop, label, BOSS_SCORE_TREND_DAYS)
  return parseBossScoreTrend(payload, label)
}

export async function syncBossShopScoreForShop(params: {
  shop: GoodReviewShopDefinition
  liveAccountId: string
  forceFetch?: boolean
}): Promise<{ skipped: boolean; saved: boolean; scoreDate: string | null; reason?: string }> {
  const todayKey = formatDateKeyShanghai()
  if (!params.forceFetch && !shouldFetchShopScoreToday()) {
    return { skipped: true, saved: false, scoreDate: null, reason: '未到15:10，跳过店铺分请求' }
  }

  const existingToday = await prisma.bossShopScoreSnapshot.findUnique({
    where: { shopKey_scoreDate: { shopKey: params.shop.shopKey, scoreDate: todayKey } },
  })
  if (!params.forceFetch && existingToday?.fetchedAt) {
    return { skipped: true, saved: false, scoreDate: todayKey, reason: '今日快照已存在' }
  }

  const scorePayload = await fetchBossShopScore(params.shop)
  let parsed = parseBossShopScore(scorePayload)
  const scoreDate = parsed.scoreDate ?? todayKey

  if (parsed.scoreDate && parsed.scoreDate < todayKey && !params.forceFetch) {
    logInfo('老板同步', `${params.shop.shopName} 店铺分仍为旧日期 ${parsed.scoreDate}，不写入今日快照`)
    return { skipped: true, saved: false, scoreDate: parsed.scoreDate, reason: '平台评分日期未更新' }
  }

  if (parsed.qualityScore == null) {
    const qTrend = await loadTrendScores(params.shop, BOSS_SCORE_TREND_LABELS.quality)
    const latest = qTrend[qTrend.length - 1]
    if (latest) parsed = { ...parsed, qualityScore: latest.score, scoreDate: latest.date }
  }
  if (parsed.logisticsScore == null) {
    const lTrend = await loadTrendScores(params.shop, BOSS_SCORE_TREND_LABELS.logistics)
    const latest = lTrend[lTrend.length - 1]
    if (latest) parsed = { ...parsed, logisticsScore: latest.score }
  }
  if (parsed.serviceScore == null) {
    const sTrend = await loadTrendScores(params.shop, BOSS_SCORE_TREND_LABELS.service)
    const latest = sTrend[sTrend.length - 1]
    if (latest) parsed = { ...parsed, serviceScore: latest.score }
  }

  const finalDate = parsed.scoreDate ?? todayKey
  const duplicate = await prisma.bossShopScoreSnapshot.findUnique({
    where: { shopKey_scoreDate: { shopKey: params.shop.shopKey, scoreDate: finalDate } },
  })
  if (
    duplicate &&
    duplicate.qualityScore === parsed.qualityScore &&
    duplicate.logisticsScore === parsed.logisticsScore &&
    duplicate.serviceScore === parsed.serviceScore &&
    duplicate.officialOverallScore === parsed.officialOverallScore
  ) {
    return { skipped: true, saved: false, scoreDate: finalDate, reason: '评分未变化' }
  }

  const prev = await prisma.bossShopScoreSnapshot.findFirst({
    where: { shopKey: params.shop.shopKey, scoreDate: { lt: finalDate } },
    orderBy: { scoreDate: 'desc' },
  })

  await prisma.bossShopScoreSnapshot.upsert({
    where: { shopKey_scoreDate: { shopKey: params.shop.shopKey, scoreDate: finalDate } },
    create: {
      shopKey: params.shop.shopKey,
      liveAccountId: params.liveAccountId,
      scoreDate: finalDate,
      qualityScore: parsed.qualityScore,
      logisticsScore: parsed.logisticsScore,
      serviceScore: parsed.serviceScore,
      officialOverallScore: parsed.officialOverallScore,
      sourceApi: 'boss_shop_score',
      rawJson: parsed.raw ? JSON.stringify(parsed.raw) : null,
      fetchedAt: new Date(),
    },
    update: {
      liveAccountId: params.liveAccountId,
      qualityScore: parsed.qualityScore,
      logisticsScore: parsed.logisticsScore,
      serviceScore: parsed.serviceScore,
      officialOverallScore: parsed.officialOverallScore,
      rawJson: parsed.raw ? JSON.stringify(parsed.raw) : null,
      fetchedAt: new Date(),
    },
  })

  await createScoreChangeAnnouncements({
    shop: params.shop,
    scoreDate: finalDate,
    previous: prev,
    current: parsed,
  })

  return { skipped: false, saved: true, scoreDate: finalDate }
}

export async function loadBossScoreTrendSeries(
  shop: GoodReviewShopDefinition,
): Promise<{
  quality: Array<{ date: string; score: number | null }>
  logistics: Array<{ date: string; score: number | null }>
  service: Array<{ date: string; score: number | null }>
}> {
  const snapshots = await prisma.bossShopScoreSnapshot.findMany({
    where: { shopKey: shop.shopKey },
    orderBy: { scoreDate: 'asc' },
    take: BOSS_SCORE_TREND_DAYS * 2,
  })
  const recent = snapshots.slice(-BOSS_SCORE_TREND_DAYS)
  const toSeries = (key: 'qualityScore' | 'logisticsScore' | 'serviceScore') =>
    recent.map((s) => ({ date: s.scoreDate, score: s[key] }))
  return {
    quality: toSeries('qualityScore'),
    logistics: toSeries('logisticsScore'),
    service: toSeries('serviceScore'),
  }
}
