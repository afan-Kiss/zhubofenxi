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

type ScoreFetchResult = Awaited<ReturnType<typeof fetchBossShopScoreAudited>>
type TrendFetchResult = Awaited<ReturnType<typeof fetchBossShopScoreTrendAudited>>

/** 验收注入：直接测生产 syncBossShopScoreForShop，勿复制 skip/upsert 逻辑 */
let scoreFetchOverrideForTests:
  | ((shop: GoodReviewShopDefinition) => Promise<ScoreFetchResult>)
  | null = null
let trendFetchOverrideForTests:
  | ((shop: GoodReviewShopDefinition, label: string, nDayRecent: number) => Promise<TrendFetchResult>)
  | null = null

export function setBossShopScoreFetchersForTests(opts: {
  score?: ((shop: GoodReviewShopDefinition) => Promise<ScoreFetchResult>) | null
  trend?: ((
    shop: GoodReviewShopDefinition,
    label: string,
    nDayRecent: number,
  ) => Promise<TrendFetchResult>) | null
} | null): void {
  scoreFetchOverrideForTests = opts?.score ?? null
  trendFetchOverrideForTests = opts?.trend ?? null
}

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
  officialOverallScore: number | null
  sourceApi: string | null
} | null): boolean {
  if (!row) return false
  return (
    row.qualityScore != null &&
    row.logisticsScore != null &&
    row.serviceScore != null &&
    row.officialOverallScore != null &&
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
  const res = await (trendFetchOverrideForTests
    ? trendFetchOverrideForTests(shop, label, BOSS_SCORE_TREND_DAYS)
    : fetchBossShopScoreTrendAudited(shop, label, BOSS_SCORE_TREND_DAYS))
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

  const scoreRes = await (scoreFetchOverrideForTests
    ? scoreFetchOverrideForTests(params.shop)
    : fetchBossShopScoreAudited(params.shop))
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

  const primaryScoreDate = parsed.scoreDate ?? todayKey
  const errors: string[] = []
  const warnings: string[] = []
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
      // 趋势曲线常滞后一天：优先同日点，否则用主日期及之前最近一点补当日分项（不改写主日期）
      if (parsed[field] == null) {
        const sameDay = trend.points.find((pt) => pt.date === primaryScoreDate)
        const prior =
          sameDay ??
          [...trend.points]
            .filter((pt) => pt.date <= primaryScoreDate)
            .sort((a, b) => b.date.localeCompare(a.date))[0]
        if (prior) {
          parsed = { ...parsed, [field]: prior.score }
        }
      }
    } else if (trend.error) {
      const labelName =
        label === BOSS_SCORE_TREND_LABELS.quality
          ? '品质'
          : label === BOSS_SCORE_TREND_LABELS.logistics
            ? '物流'
            : '服务'
      warnings.push(`${labelName}趋势：${trend.error}`)
    }
  }

  // 主接口日期是快照事实日期；趋势补值不得改写
  parsed = { ...parsed, scoreDate: primaryScoreDate }
  const finalDate = primaryScoreDate
  const hasAnyScore =
    parsed.qualityScore != null ||
    parsed.logisticsScore != null ||
    parsed.serviceScore != null ||
    parsed.officialOverallScore != null

  if (!hasAnyScore) {
    return {
      skipped: false,
      saved: false,
      scoreDate: finalDate,
      reason: [...errors, ...warnings].join('；') || '无有效分项',
    }
  }

  const duplicate = await prisma.bossShopScoreSnapshot.findUnique({
    where: { shopKey_scoreDate: { shopKey: params.shop.shopKey, scoreDate: finalDate } },
  })
  const prev = await prisma.bossShopScoreSnapshot.findFirst({
    where: { shopKey: params.shop.shopKey, scoreDate: { lt: finalDate } },
    orderBy: { scoreDate: 'desc' },
  })

  // 主接口常只有总分；趋势又滞后时，沿用上一完整快照分项，避免日报「—」
  const merged = {
    qualityScore: parsed.qualityScore ?? duplicate?.qualityScore ?? prev?.qualityScore ?? null,
    logisticsScore:
      parsed.logisticsScore ?? duplicate?.logisticsScore ?? prev?.logisticsScore ?? null,
    serviceScore: parsed.serviceScore ?? duplicate?.serviceScore ?? prev?.serviceScore ?? null,
    officialOverallScore: parsed.officialOverallScore ?? duplicate?.officialOverallScore ?? null,
  }

  const allComplete =
    merged.qualityScore != null &&
    merged.logisticsScore != null &&
    merged.serviceScore != null &&
    merged.officialOverallScore != null
  // 趋势失败但主接口四项齐全 → 仍算完整；仅缺字段才 partial
  const partial = !allComplete
  if (warnings.length) {
    logInfo(
      '老板同步',
      `${params.shop.shopName} 店铺分趋势告警：${warnings.join('；')}（主快照仍按完整性判定）`,
    )
  }

  if (
    duplicate &&
    duplicate.qualityScore === merged.qualityScore &&
    duplicate.logisticsScore === merged.logisticsScore &&
    duplicate.serviceScore === merged.serviceScore &&
    duplicate.officialOverallScore === merged.officialOverallScore
  ) {
    // 分数相同但旧快照为 partial、本次已完整 → 仍须升级 sourceApi/rawJson/fetchedAt
    const upgradingPartialToComplete =
      duplicate.sourceApi === 'boss_shop_score:partial' && !partial
    if (!upgradingPartialToComplete) {
      return { skipped: true, saved: false, scoreDate: finalDate, reason: '评分未变化' }
    }
  }

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
        officialCompareStatus: parsed.officialCompareStatus,
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
