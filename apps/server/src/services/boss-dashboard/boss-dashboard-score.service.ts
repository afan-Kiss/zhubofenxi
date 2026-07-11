import { prisma } from '../../lib/prisma'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  BOSS_SCORE_SYNC_AFTER_HM,
  BOSS_SCORE_TREND_DAYS,
  BOSS_SCORE_TREND_LABELS,
} from '../../config/boss-dashboard.constants'
import { formatDateKeyShanghai } from '../../utils/business-timezone'
import {
  fetchBossShopScoreAudited,
  fetchBossShopScoreTrendAudited,
} from './boss-dashboard-api.service'
import {
  parseBossScoreTrend,
  parseBossShopScore,
} from './boss-dashboard-normalize.service'
import { createScoreChangeAnnouncements } from './boss-dashboard-announcement.service'
import {
  clearBossShopScoreStale,
  markBossShopScoreStale,
} from './boss-dashboard-score-cooldown.util'
import { logInfo, logWarn } from '../../utils/server-log'

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

function isScoreSnapshotComplete(row: {
  qualityScore: number | null
  logisticsScore: number | null
  serviceScore: number | null
  sourceApi: string | null
} | null): boolean {
  if (!row) return false
  return (
    row.qualityScore != null &&
    row.logisticsScore != null &&
    row.serviceScore != null &&
    row.sourceApi !== 'boss_shop_score:partial'
  )
}

type ScoreField = 'qualityScore' | 'logisticsScore' | 'serviceScore'

const TREND_LABEL_TO_FIELD: Record<string, ScoreField> = {
  [BOSS_SCORE_TREND_LABELS.quality]: 'qualityScore',
  [BOSS_SCORE_TREND_LABELS.logistics]: 'logisticsScore',
  [BOSS_SCORE_TREND_LABELS.service]: 'serviceScore',
}

async function persistTrendScorePoints(params: {
  shopKey: string
  liveAccountId: string
  field: ScoreField
  points: Array<{ date: string; score: number }>
}): Promise<void> {
  const now = new Date()
  for (const pt of params.points) {
    await prisma.bossShopScoreSnapshot.upsert({
      where: {
        shopKey_scoreDate: { shopKey: params.shopKey, scoreDate: pt.date },
      },
      create: {
        shopKey: params.shopKey,
        liveAccountId: params.liveAccountId,
        scoreDate: pt.date,
        qualityScore: params.field === 'qualityScore' ? pt.score : null,
        logisticsScore: params.field === 'logisticsScore' ? pt.score : null,
        serviceScore: params.field === 'serviceScore' ? pt.score : null,
        officialOverallScore: null,
        sourceApi: 'boss_shop_score:trend',
        fetchedAt: now,
      },
      update: {
        liveAccountId: params.liveAccountId,
        [params.field]: pt.score,
        fetchedAt: now,
      },
    })
  }
}

async function loadTrendScores(
  shop: GoodReviewShopDefinition,
  label: string,
): Promise<{ points: Array<{ date: string; score: number }>; error?: string }> {
  const res = await fetchBossShopScoreTrendAudited(shop, label, BOSS_SCORE_TREND_DAYS)
  if (!res.ok || res.data == null) {
    return { points: [], error: res.errorMessage ?? '趋势请求失败' }
  }
  return { points: parseBossScoreTrend(res.data, label) }
}

export async function syncBossShopScoreForShop(params: {
  shop: GoodReviewShopDefinition
  liveAccountId: string
  forceFetch?: boolean
}): Promise<{
  skipped: boolean
  saved: boolean
  partial?: boolean
  scoreDate: string | null
  reason?: string
}> {
  const todayKey = formatDateKeyShanghai()
  if (!params.forceFetch && !shouldFetchShopScoreToday()) {
    return { skipped: true, saved: false, scoreDate: null, reason: '未到15:10，跳过店铺分请求' }
  }

  const existingToday = await prisma.bossShopScoreSnapshot.findUnique({
    where: { shopKey_scoreDate: { shopKey: params.shop.shopKey, scoreDate: todayKey } },
  })
  if (!params.forceFetch && existingToday?.fetchedAt && isScoreSnapshotComplete(existingToday)) {
    return { skipped: true, saved: false, scoreDate: todayKey, reason: '今日快照已完整' }
  }

  const scoreRes = await fetchBossShopScoreAudited(params.shop)
  if (!scoreRes.ok || scoreRes.data == null) {
    return {
      skipped: false,
      saved: false,
      scoreDate: null,
      reason: scoreRes.errorMessage ?? '店铺分主接口失败',
    }
  }

  let parsed = parseBossShopScore(scoreRes.data)
  const scoreDate = parsed.scoreDate ?? todayKey

  if (parsed.scoreDate && parsed.scoreDate < todayKey && !params.forceFetch) {
    markBossShopScoreStale(params.shop.shopKey, parsed.scoreDate)
    logInfo('老板同步', `${params.shop.shopName} 店铺分仍为旧日期 ${parsed.scoreDate}（stale_score_date）`)
    return { skipped: true, saved: false, scoreDate: parsed.scoreDate, reason: 'stale_score_date' }
  }

  clearBossShopScoreStale(params.shop.shopKey)

  const errors: string[] = []
  const trendLabels = [
    BOSS_SCORE_TREND_LABELS.quality,
    BOSS_SCORE_TREND_LABELS.logistics,
    BOSS_SCORE_TREND_LABELS.service,
  ] as const

  for (const label of trendLabels) {
    const field = TREND_LABEL_TO_FIELD[label]
    const trend = await loadTrendScores(params.shop, label)
    if (trend.points.length > 0) {
      await persistTrendScorePoints({
        shopKey: params.shop.shopKey,
        liveAccountId: params.liveAccountId,
        field,
        points: trend.points,
      })
      const latest = trend.points[trend.points.length - 1]
      if (latest && parsed[field] == null) {
        parsed = { ...parsed, [field]: latest.score, scoreDate: latest.date }
      }
    } else if (trend.error) {
      const labelName =
        label === BOSS_SCORE_TREND_LABELS.quality
          ? '品质'
          : label === BOSS_SCORE_TREND_LABELS.logistics
            ? '物流'
            : '服务'
      errors.push(`${labelName}趋势：${trend.error}`)
    }
  }

  const finalDate = parsed.scoreDate ?? todayKey
  const hasAnyScore =
    parsed.qualityScore != null ||
    parsed.logisticsScore != null ||
    parsed.serviceScore != null ||
    parsed.officialOverallScore != null

  if (!hasAnyScore) {
    return { skipped: false, saved: false, scoreDate: finalDate, reason: errors.join('；') || '无有效分项' }
  }

  const duplicate = await prisma.bossShopScoreSnapshot.findUnique({
    where: { shopKey_scoreDate: { shopKey: params.shop.shopKey, scoreDate: finalDate } },
  })

  const merged = {
    qualityScore: parsed.qualityScore ?? duplicate?.qualityScore ?? null,
    logisticsScore: parsed.logisticsScore ?? duplicate?.logisticsScore ?? null,
    serviceScore: parsed.serviceScore ?? duplicate?.serviceScore ?? null,
    officialOverallScore: parsed.officialOverallScore ?? duplicate?.officialOverallScore ?? null,
  }

  const allComplete =
    merged.qualityScore != null &&
    merged.logisticsScore != null &&
    merged.serviceScore != null
  const partial = !allComplete || errors.length > 0

  if (
    duplicate &&
    duplicate.qualityScore === merged.qualityScore &&
    duplicate.logisticsScore === merged.logisticsScore &&
    duplicate.serviceScore === merged.serviceScore &&
    duplicate.officialOverallScore === merged.officialOverallScore
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
      qualityScore: merged.qualityScore,
      logisticsScore: merged.logisticsScore,
      serviceScore: merged.serviceScore,
      officialOverallScore: merged.officialOverallScore,
      sourceApi: partial ? 'boss_shop_score:partial' : 'boss_shop_score',
      rawJson: parsed.raw ? JSON.stringify(parsed.raw) : null,
      fetchedAt: new Date(),
    },
    update: {
      liveAccountId: params.liveAccountId,
      qualityScore: merged.qualityScore,
      logisticsScore: merged.logisticsScore,
      serviceScore: merged.serviceScore,
      officialOverallScore: merged.officialOverallScore,
      sourceApi: partial ? 'boss_shop_score:partial' : 'boss_shop_score',
      rawJson: parsed.raw ? JSON.stringify(parsed.raw) : null,
      fetchedAt: new Date(),
    },
  })

  if (prev && allComplete) {
    await createScoreChangeAnnouncements({
      shop: params.shop,
      scoreDate: finalDate,
      previous: prev,
      current: {
        scoreDate: finalDate,
        qualityScore: merged.qualityScore,
        logisticsScore: merged.logisticsScore,
        serviceScore: merged.serviceScore,
        officialOverallScore: merged.officialOverallScore,
        raw: parsed.raw ?? null,
      },
    })
  } else if (partial) {
    logWarn('老板同步', `${params.shop.shopName} 店铺分部分成功：${errors.join('；') || '分项未齐'}`)
  }

  return {
    skipped: false,
    saved: true,
    partial,
    scoreDate: finalDate,
    reason: partial ? errors.join('；') || 'partial_success' : undefined,
  }
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
    orderBy: { scoreDate: 'desc' },
    take: BOSS_SCORE_TREND_DAYS * 3,
  })
  const byDate = new Map<
    string,
    { qualityScore: number | null; logisticsScore: number | null; serviceScore: number | null }
  >()
  for (const row of snapshots) {
    const existing = byDate.get(row.scoreDate)
    if (!existing) {
      byDate.set(row.scoreDate, {
        qualityScore: row.qualityScore,
        logisticsScore: row.logisticsScore,
        serviceScore: row.serviceScore,
      })
      continue
    }
    byDate.set(row.scoreDate, {
      qualityScore: row.qualityScore ?? existing.qualityScore,
      logisticsScore: row.logisticsScore ?? existing.logisticsScore,
      serviceScore: row.serviceScore ?? existing.serviceScore,
    })
  }
  const recentDates = [...byDate.keys()].sort().slice(-BOSS_SCORE_TREND_DAYS)
  const toSeries = (key: 'qualityScore' | 'logisticsScore' | 'serviceScore') =>
    recentDates.map((date) => ({
      date,
      score: byDate.get(date)?.[key] ?? null,
    }))
  return {
    quality: toSeries('qualityScore'),
    logistics: toSeries('logisticsScore'),
    service: toSeries('serviceScore'),
  }
}
