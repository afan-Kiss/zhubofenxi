/**
 * 日报长图：读取各店体验分快照（只读本地 BossShopScoreSnapshot，不打千帆）
 * 按 reportDate 取「当日或之前最近」快照，并与上一快照算 delta
 *
 * 注意：delta = 较「上次快照」，不是日报经营日环比，也不是「昨日变化」。
 */
import { prisma } from '../lib/prisma'
import {
  BOSS_DASHBOARD_SHOPS,
  type BossDashboardShopKey,
} from '../config/boss-dashboard.constants'
import { logWarn } from '../utils/server-log'

export interface DailyReportShopScoreItem {
  shopKey: BossDashboardShopKey
  shopName: string
  /** 所用快照日期（可能早于日报日） */
  scoreDate: string | null
  /** 对比用的上一快照日期 */
  previousScoreDate: string | null
  overallScore: number | null
  overallDelta: number | null
  qualityScore: number | null
  logisticsScore: number | null
  serviceScore: number | null
  qualityDelta: number | null
  logisticsDelta: number | null
  serviceDelta: number | null
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

export function resolveOverallScore(
  quality: number | null,
  logistics: number | null,
  service: number | null,
  official: number | null,
): number | null {
  if (official != null && Number.isFinite(official)) return roundScore2(official)
  const parts = [quality, logistics, service].filter(
    (v): v is number => v != null && Number.isFinite(v),
  )
  if (parts.length === 0) return null
  return roundScore2(parts.reduce((s, v) => s + v, 0) / parts.length)
}

/** 至少有一项可展示分数才算 available */
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
    qualityScore: null,
    logisticsScore: null,
    serviceScore: null,
    qualityDelta: null,
    logisticsDelta: null,
    serviceDelta: null,
    available: false,
  }
}

export async function loadDailyReportShopScores(
  reportDate: string,
): Promise<DailyReportShopScoreItem[]> {
  const dateKey = reportDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return BOSS_DASHBOARD_SHOPS.map(emptyShopItem)
  }

  try {
    return await Promise.all(
      BOSS_DASHBOARD_SHOPS.map(async (shop) => {
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

        if (!row) return emptyShopItem(shop)

        const qualityScore =
          row.qualityScore != null && Number.isFinite(row.qualityScore) ? row.qualityScore : null
        const logisticsScore =
          row.logisticsScore != null && Number.isFinite(row.logisticsScore)
            ? row.logisticsScore
            : null
        const serviceScore =
          row.serviceScore != null && Number.isFinite(row.serviceScore) ? row.serviceScore : null
        const official =
          row.officialOverallScore != null && Number.isFinite(row.officialOverallScore)
            ? row.officialOverallScore
            : null

        const overallScore = resolveOverallScore(
          qualityScore,
          logisticsScore,
          serviceScore,
          official,
        )
        const prevOverall = prev
          ? resolveOverallScore(
              prev.qualityScore != null && Number.isFinite(prev.qualityScore)
                ? prev.qualityScore
                : null,
              prev.logisticsScore != null && Number.isFinite(prev.logisticsScore)
                ? prev.logisticsScore
                : null,
              prev.serviceScore != null && Number.isFinite(prev.serviceScore)
                ? prev.serviceScore
                : null,
              prev.officialOverallScore != null && Number.isFinite(prev.officialOverallScore)
                ? prev.officialOverallScore
                : null,
            )
          : null

        const item: DailyReportShopScoreItem = {
          shopKey: shop.shopKey,
          shopName: shop.shopName,
          scoreDate: row.scoreDate,
          previousScoreDate: prev?.scoreDate ?? null,
          overallScore,
          overallDelta: scoreDelta(overallScore, prevOverall),
          qualityScore,
          logisticsScore,
          serviceScore,
          qualityDelta: scoreDelta(
            qualityScore,
            prev?.qualityScore != null && Number.isFinite(prev.qualityScore)
              ? prev.qualityScore
              : null,
          ),
          logisticsDelta: scoreDelta(
            logisticsScore,
            prev?.logisticsScore != null && Number.isFinite(prev.logisticsScore)
              ? prev.logisticsScore
              : null,
          ),
          serviceDelta: scoreDelta(
            serviceScore,
            prev?.serviceScore != null && Number.isFinite(prev.serviceScore)
              ? prev.serviceScore
              : null,
          ),
          available: false,
        }
        item.available = hasUsableShopScore(item)
        return item
      }),
    )
  } catch (err) {
    logWarn(
      'daily-report-shop-scores',
      `加载体验分失败，日报继续生成：${err instanceof Error ? err.message : String(err)}`,
    )
    return BOSS_DASHBOARD_SHOPS.map(emptyShopItem)
  }
}
