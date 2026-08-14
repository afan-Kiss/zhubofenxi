/**
 * 日报长图：读取各店体验分快照（只读本地 BossShopScoreSnapshot，不打千帆）
 * 按 reportDate 取「当日或之前最近」快照，并与上一快照算 delta
 *
 * 综合分仅使用 officialOverallScore（千帆 shop_score_dto.score），禁止分项均值兜底。
 * 趋势基于官方展示 1 位小数（或官方较前日状态），禁止「上升 +0.0」。
 */
import { prisma } from '../lib/prisma'
import {
  BOSS_DASHBOARD_SHOPS,
  type BossDashboardShopKey,
} from '../config/boss-dashboard.constants'
import { logWarn } from '../utils/server-log'
import {
  normalizeOfficialDisplayScore,
  resolveOfficialOverallScore,
  resolveOfficialTrend,
  type OfficialScoreTrendLabel,
} from './boss-dashboard/boss-shop-score-official.util'

/** 日报体验分固定顺序（与前端一致；缺数据也占位） */
export const DAILY_REPORT_SHOP_SCORE_ORDER: BossDashboardShopKey[] = [
  'shiyuju',
  'xyxiangyu',
  'hetianyayu',
  'xiangyu',
]

const SHOPS_BY_KEY = new Map(BOSS_DASHBOARD_SHOPS.map((s) => [s.shopKey, s]))

function shopsInReportOrder() {
  return DAILY_REPORT_SHOP_SCORE_ORDER.map((key) => {
    const shop = SHOPS_BY_KEY.get(key)
    if (!shop) throw new Error(`missing shop definition: ${key}`)
    return shop
  })
}

export interface DailyReportShopScoreItem {
  shopKey: BossDashboardShopKey
  shopName: string
  /** 所用快照日期（可能早于日报日） */
  scoreDate: string | null
  /** 对比用的上一快照日期 */
  previousScoreDate: string | null
  /** 官方总分（shop_score_dto.score）；缺失为 null → 展示 — */
  overallScore: number | null
  /** 官方展示精度下的综合分变化；持平时为 0 */
  overallDelta: number | null
  overallTrend: OfficialScoreTrendLabel
  qualityScore: number | null
  logisticsScore: number | null
  serviceScore: number | null
  qualityDelta: number | null
  logisticsDelta: number | null
  serviceDelta: number | null
  qualityTrend: OfficialScoreTrendLabel
  logisticsTrend: OfficialScoreTrendLabel
  serviceTrend: OfficialScoreTrendLabel
  available: boolean
}

export function roundScore2(n: number): number {
  return Math.round(n * 100) / 100
}

export function scoreDelta(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null) return null
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null
  return roundScore2(cur - prev)
}

/**
 * @deprecated 日报综合分请用 resolveOfficialOverallScore；保留仅供旧调用探测，恒忽略分项
 */
export function resolveOverallScore(
  _quality: number | null,
  _logistics: number | null,
  _service: number | null,
  official: number | null,
): number | null {
  return resolveOfficialOverallScore(official)
}

function pickFinite(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) ? n : null
}

function readOfficialCompareStatus(rawJson: string | null | undefined): string | null {
  if (!rawJson) return null
  try {
    const raw = JSON.parse(rawJson) as Record<string, unknown>
    const dto =
      (raw.shop_score_dto as Record<string, unknown> | undefined) ??
      (raw.shopScoreDto as Record<string, unknown> | undefined) ??
      raw
    const keys = [
      'compareYesterdayDesc',
      'compareYesterdayText',
      'scoreChangeDesc',
      'changeDesc',
      'yesterdayCompareDesc',
      'compareStatus',
      'scoreTrendDesc',
    ]
    for (const k of keys) {
      const v = dto?.[k]
      if (v != null && String(v).trim()) return String(v).trim()
    }
  } catch {
    /* ignore */
  }
  return null
}

function trendFields(
  current: number | null,
  previous: number | null,
  officialCompareStatus?: string | null,
  opts?: {
    currentOverallOnly?: boolean
    previousSubs?: {
      qualityScore: number | null
      logisticsScore: number | null
      serviceScore: number | null
    } | null
  },
): { delta: number | null; trend: OfficialScoreTrendLabel } {
  const resolved = resolveOfficialTrend({
    current,
    previous,
    officialCompareStatus,
    currentOverallOnly: opts?.currentOverallOnly,
    previousSubs: opts?.previousSubs,
  })
  return { delta: resolved.displayDelta, trend: resolved.label }
}

/** 至少有一项可展示分数才算 available（综合分缺失仍可看分项） */
export function hasUsableShopScore(scores: {
  overallScore: number | null
  qualityScore: number | null
  logisticsScore: number | null
  serviceScore: number | null
}): boolean {
  return (
    scores.overallScore != null ||
    scores.qualityScore != null ||
    scores.logisticsScore != null ||
    scores.serviceScore != null
  )
}

function emptyShopItem(shop: {
  shopKey: BossDashboardShopKey
  shopName: string
}): DailyReportShopScoreItem {
  return {
    shopKey: shop.shopKey,
    shopName: shop.shopName,
    scoreDate: null,
    previousScoreDate: null,
    overallScore: null,
    overallDelta: null,
    overallTrend: '持平',
    qualityScore: null,
    logisticsScore: null,
    serviceScore: null,
    qualityDelta: null,
    logisticsDelta: null,
    serviceDelta: null,
    qualityTrend: '持平',
    logisticsTrend: '持平',
    serviceTrend: '持平',
    available: false,
  }
}

export async function loadDailyReportShopScores(
  reportDate: string,
): Promise<DailyReportShopScoreItem[]> {
  const dateKey = reportDate.trim()
  const shops = shopsInReportOrder()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return shops.map(emptyShopItem)
  }

  try {
    // 逐店按 shopKey 查询，禁止用 Promise 结果下标绑定店铺
    const byKey = new Map<BossDashboardShopKey, DailyReportShopScoreItem>()

    await Promise.all(
      shops.map(async (shop) => {
        const row = await prisma.bossShopScoreSnapshot.findFirst({
          where: { shopKey: shop.shopKey, scoreDate: { lte: dateKey } },
          orderBy: { scoreDate: 'desc' },
        })
        const prev = row
          ? await prisma.bossShopScoreSnapshot.findFirst({
              where: { shopKey: shop.shopKey, scoreDate: { lt: row.scoreDate } },
              orderBy: { scoreDate: 'desc' },
            })
          : null

        if (!row) {
          byKey.set(shop.shopKey, emptyShopItem(shop))
          return
        }

        const qualityScore = pickFinite(row.qualityScore)
        const logisticsScore = pickFinite(row.logisticsScore)
        const serviceScore = pickFinite(row.serviceScore)
        const overallScore = resolveOfficialOverallScore(pickFinite(row.officialOverallScore))
        const prevOverall = resolveOfficialOverallScore(pickFinite(prev?.officialOverallScore))
        const officialCompare = readOfficialCompareStatus(row.rawJson)
        const currentOverallOnly =
          overallScore != null &&
          qualityScore == null &&
          logisticsScore == null &&
          serviceScore == null
        const previousSubs = prev
          ? {
              qualityScore: pickFinite(prev.qualityScore),
              logisticsScore: pickFinite(prev.logisticsScore),
              serviceScore: pickFinite(prev.serviceScore),
            }
          : null

        const overallTrend = trendFields(overallScore, prevOverall, officialCompare, {
          currentOverallOnly,
          previousSubs,
        })
        const qualityTrend = trendFields(
          normalizeOfficialDisplayScore(qualityScore),
          normalizeOfficialDisplayScore(pickFinite(prev?.qualityScore)),
        )
        const logisticsTrend = trendFields(
          normalizeOfficialDisplayScore(logisticsScore),
          normalizeOfficialDisplayScore(pickFinite(prev?.logisticsScore)),
        )
        const serviceTrend = trendFields(
          normalizeOfficialDisplayScore(serviceScore),
          normalizeOfficialDisplayScore(pickFinite(prev?.serviceScore)),
        )

        const item: DailyReportShopScoreItem = {
          shopKey: shop.shopKey,
          shopName: shop.shopName,
          scoreDate: row.scoreDate,
          previousScoreDate: prev?.scoreDate ?? null,
          overallScore,
          overallDelta: overallTrend.delta,
          overallTrend: overallTrend.trend,
          qualityScore: normalizeOfficialDisplayScore(qualityScore),
          logisticsScore: normalizeOfficialDisplayScore(logisticsScore),
          serviceScore: normalizeOfficialDisplayScore(serviceScore),
          qualityDelta: qualityTrend.delta,
          logisticsDelta: logisticsTrend.delta,
          serviceDelta: serviceTrend.delta,
          qualityTrend: qualityTrend.trend,
          logisticsTrend: logisticsTrend.trend,
          serviceTrend: serviceTrend.trend,
          available: false,
        }
        item.available = hasUsableShopScore(item)
        byKey.set(shop.shopKey, item)
      }),
    )

    return shops.map((shop) => byKey.get(shop.shopKey) ?? emptyShopItem(shop))
  } catch (err) {
    logWarn(
      'daily-report-shop-scores',
      `加载体验分失败，日报继续生成：${err instanceof Error ? err.message : String(err)}`,
    )
    return shops.map(emptyShopItem)
  }
}

export {
  normalizeOfficialDisplayScore,
  resolveOfficialOverallScore,
  resolveOfficialTrend,
  formatOfficialDisplayScore,
  formatOfficialScoreDelta,
  impliedOfficialDisplayFromSubs,
} from './boss-dashboard/boss-shop-score-official.util'
