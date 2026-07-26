/**
 * 日报长图：读取各店体验分快照（只读本地 BossShopScoreSnapshot，不打千帆）
 * 按 reportDate 取「当日或之前最近」快照，并与上一快照算 delta
 */
import { prisma } from '../lib/prisma'
import {
  BOSS_DASHBOARD_SHOPS,
  type BossDashboardShopKey,
} from '../config/boss-dashboard.constants'

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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function scoreDelta(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null) return null
  return round2(cur - prev)
}

function resolveOverall(
  quality: number | null,
  logistics: number | null,
  service: number | null,
  official: number | null,
): number | null {
  if (official != null && Number.isFinite(official)) return round2(official)
  const parts = [quality, logistics, service].filter(
    (v): v is number => v != null && Number.isFinite(v),
  )
  if (parts.length === 0) return null
  return round2(parts.reduce((s, v) => s + v, 0) / parts.length)
}

export async function loadDailyReportShopScores(
  reportDate: string,
): Promise<DailyReportShopScoreItem[]> {
  const dateKey = reportDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return BOSS_DASHBOARD_SHOPS.map((shop) => ({
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
    }))
  }

  return Promise.all(
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

      if (!row) {
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

      const qualityScore = row.qualityScore ?? null
      const logisticsScore = row.logisticsScore ?? null
      const serviceScore = row.serviceScore ?? null
      const overallScore = resolveOverall(
        qualityScore,
        logisticsScore,
        serviceScore,
        row.officialOverallScore ?? null,
      )
      const prevOverall = prev
        ? resolveOverall(
            prev.qualityScore ?? null,
            prev.logisticsScore ?? null,
            prev.serviceScore ?? null,
            prev.officialOverallScore ?? null,
          )
        : null

      return {
        shopKey: shop.shopKey,
        shopName: shop.shopName,
        scoreDate: row.scoreDate,
        previousScoreDate: prev?.scoreDate ?? null,
        overallScore,
        overallDelta: scoreDelta(overallScore, prevOverall),
        qualityScore,
        logisticsScore,
        serviceScore,
        qualityDelta: scoreDelta(qualityScore, prev?.qualityScore ?? null),
        logisticsDelta: scoreDelta(logisticsScore, prev?.logisticsScore ?? null),
        serviceDelta: scoreDelta(serviceScore, prev?.serviceScore ?? null),
        available: true,
      }
    }),
  )
}
