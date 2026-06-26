import { OPERATIONS_ANCHOR_RANKING } from '../config/operations-anchor-ranking.config'
import { safeDivide } from './daily-report-order.util'
import type { DailyOperationsAnchorRow } from './daily-operations-report.service'
import {
  emptyRankingList,
  makeRankingQuality,
  type AnchorRankItem,
  type RankingListPayload,
} from './operations-rankings.types'

function anchorToBase(row: DailyOperationsAnchorRow): Omit<AnchorRankItem, 'rankReason' | 'sampleTooSmall'> {
  const returnRate =
    row.soldOrderCount > 0 ? row.returnOrderCount / row.soldOrderCount : null
  const followerConversionRate =
    row.viewSessionCount != null &&
    row.viewSessionCount > 0 &&
    row.newFollowerCount != null
      ? row.newFollowerCount / row.viewSessionCount
      : null
  return {
    anchorName: row.anchorName,
    shopName: row.shopName || '—',
    validAmountYuan: row.validAmountYuan,
    soldOrderCount: row.soldOrderCount,
    returnOrderCount: row.returnOrderCount,
    returnRate,
    liveDurationMinutes: row.liveDurationMinutes,
    hourlyAmountYuan: row.hourlyAmountYuan,
    viewSessionCount: row.viewSessionCount,
    joinUserCount: row.joinUserCount,
    dealUserCount: row.dealUserCount,
    dealConversionRate: row.dealConversionRate,
    newFollowerCount: row.newFollowerCount,
    followerConversionRate,
    averageOrderValueYuan: row.avgOrderAmountYuan,
  }
}

function stableAnchorSort(a: AnchorRankItem, b: AnchorRankItem): number {
  return a.anchorName.localeCompare(b.anchorName, 'zh-CN')
}

function buildAnchorItem(
  row: DailyOperationsAnchorRow,
  rankReason: string,
  sampleTooSmall = false,
): AnchorRankItem {
  return { ...anchorToBase(row), rankReason, sampleTooSmall }
}

const PERFORMANCE_BASIS = 'computed_from_valid_performance_view' as const
const TRAFFIC_BASIS = 'official_live_traffic' as const

function performanceQuality(reliable = true): ReturnType<typeof makeRankingQuality> {
  return makeRankingQuality(PERFORMANCE_BASIS, reliable, reliable ? 'high' : 'insufficient')
}

function trafficQuality(
  rows: DailyOperationsAnchorRow[],
  needFields: Array<'dealUserCount' | 'joinUserCount' | 'newFollowerCount' | 'viewSessionCount'>,
): ReturnType<typeof makeRankingQuality> {
  const missing: string[] = []
  const warnings: string[] = []
  for (const field of needFields) {
    const allMissing = rows.every((r) => r[field] == null)
    if (allMissing) missing.push(field)
  }
  if (missing.includes('dealUserCount')) {
    warnings.push('成交人数缺失，成交率不可计算')
  }
  if (missing.includes('joinUserCount')) {
    warnings.push('进房人数缺失，成交率不可计算')
  }
  if (missing.includes('newFollowerCount')) {
    warnings.push('新增粉丝字段缺失')
  }
  if (missing.includes('viewSessionCount')) {
    warnings.push('场观字段缺失，粉丝转化率不可计算')
  }
  const reliable = missing.length === 0
  return makeRankingQuality(
    TRAFFIC_BASIS,
    reliable,
    reliable ? 'high' : 'insufficient',
    warnings,
    missing.length > 0 ? missing : undefined,
  )
}

export function buildAnchorRankingsByAmount(
  rows: DailyOperationsAnchorRow[],
  limit: number = OPERATIONS_ANCHOR_RANKING.defaultLimit,
): RankingListPayload<AnchorRankItem> {
  const pool = rows.filter((r) => r.validAmountYuan > 0 || r.soldOrderCount > 0)
  const sorted = [...pool].sort(
    (a, b) =>
      b.validAmountYuan - a.validAmountYuan ||
      b.soldOrderCount - a.soldOrderCount ||
      a.anchorName.localeCompare(b.anchorName, 'zh-CN'),
  )
  return {
    rankingType: 'anchor_by_amount',
    title: '主播成交金额榜',
    subtitle: '按有效成交金额、成交订单排序；排除低价刷单与关闭单',
    rankReasonTemplate: '有效成交金额最高',
    items: sorted.slice(0, limit).map((r) => buildAnchorItem(r, '有效成交金额最高')),
    dataQuality: performanceQuality(pool.length > 0),
  }
}

export function buildAnchorRankingsByOrders(
  rows: DailyOperationsAnchorRow[],
  limit: number = OPERATIONS_ANCHOR_RANKING.defaultLimit,
): RankingListPayload<AnchorRankItem> {
  const pool = rows.filter((r) => r.soldOrderCount > 0)
  const sorted = [...pool].sort(
    (a, b) =>
      b.soldOrderCount - a.soldOrderCount ||
      b.validAmountYuan - a.validAmountYuan ||
      a.anchorName.localeCompare(b.anchorName, 'zh-CN'),
  )
  return {
    rankingType: 'anchor_by_orders',
    title: '主播成交订单榜',
    subtitle: '按有效成交订单、成交金额排序',
    rankReasonTemplate: '有效成交订单数最高',
    items: sorted.slice(0, limit).map((r) => buildAnchorItem(r, '有效成交订单数最高')),
    dataQuality: performanceQuality(pool.length > 0),
  }
}

export function buildAnchorRankingsByHourlyAmount(
  rows: DailyOperationsAnchorRow[],
  limit: number = OPERATIONS_ANCHOR_RANKING.defaultLimit,
): RankingListPayload<AnchorRankItem> {
  const minMin = OPERATIONS_ANCHOR_RANKING.minLiveDurationMinutesForHourly
  const withDuration = rows.filter((r) => r.liveDurationMinutes > 0 && r.validAmountYuan > 0)
  const formalPool = withDuration.filter((r) => r.liveDurationMinutes >= minMin)
  const samplePool = withDuration.filter((r) => r.liveDurationMinutes < minMin)

  const sortHourly = (a: DailyOperationsAnchorRow, b: DailyOperationsAnchorRow) => {
    const ah = a.hourlyAmountYuan ?? 0
    const bh = b.hourlyAmountYuan ?? 0
    return bh - ah || b.validAmountYuan - a.validAmountYuan || stableAnchorSort(
      anchorToBase(a) as AnchorRankItem,
      anchorToBase(b) as AnchorRankItem,
    )
  }

  const warnings: string[] = []
  if (samplePool.length > 0) {
    warnings.push(`直播时长不足 ${minMin} 分钟的主播仅进入参考区`)
  }

  return {
    rankingType: 'anchor_by_hourly_amount',
    title: '主播每小时成交榜',
    subtitle: `有效成交金额 / 直播小时；正式榜要求直播 ≥${minMin} 分钟`,
    rankReasonTemplate: '每小时成交金额最高',
    items: [...formalPool].sort(sortHourly).slice(0, limit).map((r) =>
      buildAnchorItem(r, `每小时成交 ¥${r.hourlyAmountYuan ?? 0}`),
    ),
    sampleTooSmall: [...samplePool].sort(sortHourly).slice(0, limit).map((r) =>
      buildAnchorItem(
        r,
        `直播时长 ${r.liveDurationMinutes} 分钟，样本不足`,
        true,
      ),
    ),
    dataQuality: makeRankingQuality(
      PERFORMANCE_BASIS,
      formalPool.length > 0,
      formalPool.length > 0 ? 'high' : samplePool.length > 0 ? 'low' : 'insufficient',
      warnings,
    ),
  }
}

export function buildAnchorRankingsByDealConversion(
  rows: DailyOperationsAnchorRow[],
  limit: number = OPERATIONS_ANCHOR_RANKING.defaultLimit,
): RankingListPayload<AnchorRankItem> {
  const pool = rows.filter(
    (r) =>
      r.joinUserCount != null &&
      r.joinUserCount > 0 &&
      r.dealUserCount != null &&
      r.dealConversionRate != null,
  )
  const sorted = [...pool].sort(
    (a, b) =>
      (b.dealConversionRate ?? 0) - (a.dealConversionRate ?? 0) ||
      (b.dealUserCount ?? 0) - (a.dealUserCount ?? 0) ||
      a.anchorName.localeCompare(b.anchorName, 'zh-CN'),
  )
  const quality = trafficQuality(rows, ['dealUserCount', 'joinUserCount'])
  return {
    rankingType: 'anchor_by_deal_conversion',
    title: '主播成交率榜',
    subtitle: '成交率 = 官方成交人数 / 官方进房人数；不使用订单数替代',
    rankReasonTemplate: '官方成交率最高',
    items: sorted.slice(0, limit).map((r) =>
      buildAnchorItem(
        r,
        `成交人数 ${r.dealUserCount}/${r.joinUserCount}`,
      ),
    ),
    dataQuality: quality,
  }
}

export function buildAnchorRankingsByNewFollowers(
  rows: DailyOperationsAnchorRow[],
  limit: number = OPERATIONS_ANCHOR_RANKING.defaultLimit,
): RankingListPayload<AnchorRankItem> {
  const pool = rows.filter((r) => r.newFollowerCount != null && r.newFollowerCount > 0)
  const sorted = [...pool].sort(
    (a, b) =>
      (b.newFollowerCount ?? 0) - (a.newFollowerCount ?? 0) ||
      (b.viewSessionCount ?? 0) - (a.viewSessionCount ?? 0) ||
      a.anchorName.localeCompare(b.anchorName, 'zh-CN'),
  )
  const quality = trafficQuality(rows, ['newFollowerCount'])
  return {
    rankingType: 'anchor_by_new_followers',
    title: '主播新增粉丝榜',
    subtitle: '按官方直播新增粉丝数排序',
    rankReasonTemplate: '官方新增粉丝数最高',
    items: sorted.slice(0, limit).map((r) => buildAnchorItem(r, '官方新增粉丝数最高')),
    dataQuality: quality,
  }
}

export function buildAnchorRankingsByFollowerConversion(
  rows: DailyOperationsAnchorRow[],
  limit: number = OPERATIONS_ANCHOR_RANKING.defaultLimit,
): RankingListPayload<AnchorRankItem> {
  const pool = rows.filter(
    (r) =>
      r.viewSessionCount != null &&
      r.viewSessionCount > 0 &&
      r.newFollowerCount != null,
  )
  const sorted = [...pool].sort((a, b) => {
    const ar = a.newFollowerCount! / a.viewSessionCount!
    const br = b.newFollowerCount! / b.viewSessionCount!
    return br - ar || (b.newFollowerCount ?? 0) - (a.newFollowerCount ?? 0)
  })
  const quality = trafficQuality(rows, ['newFollowerCount', 'viewSessionCount'])
  return {
    rankingType: 'anchor_by_follower_conversion',
    title: '主播粉丝转化榜',
    subtitle: '新增粉丝 / 场观人数',
    rankReasonTemplate: '粉丝转化率最高',
    items: sorted.slice(0, limit).map((r) =>
      buildAnchorItem(
        r,
        `新增粉丝 ${r.newFollowerCount}/${r.viewSessionCount}`,
      ),
    ),
    dataQuality: quality,
  }
}

export function buildAnchorRankingsByReturnRate(
  rows: DailyOperationsAnchorRow[],
  limit: number = OPERATIONS_ANCHOR_RANKING.defaultLimit,
): RankingListPayload<AnchorRankItem> {
  const minOrders = OPERATIONS_ANCHOR_RANKING.minSoldOrderCountForReturnRate
  const withReturns = rows.filter(
    (r) => r.returnOrderCount > 0 && r.soldOrderCount > 0,
  )
  const formalPool = withReturns.filter((r) => r.soldOrderCount >= minOrders)
  const samplePool = withReturns.filter(
    (r) => r.soldOrderCount > 0 && r.soldOrderCount < minOrders,
  )

  const sortReturn = (a: DailyOperationsAnchorRow, b: DailyOperationsAnchorRow) => {
    const ar = a.returnOrderCount / a.soldOrderCount
    const br = b.returnOrderCount / b.soldOrderCount
    return br - ar || b.returnOrderCount - a.returnOrderCount
  }

  const warnings: string[] = []
  if (samplePool.length > 0) {
    warnings.push(`成交订单不足 ${minOrders} 单的主播仅进入参考区`)
  }

  return {
    rankingType: 'anchor_by_return_rate',
    title: '主播退货率榜',
    subtitle: '商品退货订单率 = 退货订单 / 有效成交订单；排除纯运费退款',
    rankReasonTemplate: '商品退货订单率最高',
    items: [...formalPool].sort(sortReturn).slice(0, limit).map((r) =>
      buildAnchorItem(
        r,
        `商品退货订单率 ${r.returnOrderCount}/${r.soldOrderCount}`,
      ),
    ),
    sampleTooSmall: [...samplePool].sort(sortReturn).slice(0, limit).map((r) =>
      buildAnchorItem(
        r,
        `样本不足：商品退货订单率 ${r.returnOrderCount}/${r.soldOrderCount}`,
        true,
      ),
    ),
    dataQuality: makeRankingQuality(
      PERFORMANCE_BASIS,
      formalPool.length > 0,
      formalPool.length > 0 ? 'high' : samplePool.length > 0 ? 'low' : 'insufficient',
      warnings,
    ),
  }
}

export function buildAllAnchorRankings(
  rows: DailyOperationsAnchorRow[],
  limit: number = OPERATIONS_ANCHOR_RANKING.defaultLimit,
) {
  return {
    byAmount: buildAnchorRankingsByAmount(rows, limit),
    byOrders: buildAnchorRankingsByOrders(rows, limit),
    byHourlyAmount: buildAnchorRankingsByHourlyAmount(rows, limit),
    byDealConversion: buildAnchorRankingsByDealConversion(rows, limit),
    byNewFollowers: buildAnchorRankingsByNewFollowers(rows, limit),
    byFollowerConversion: buildAnchorRankingsByFollowerConversion(rows, limit),
    byReturnRate: buildAnchorRankingsByReturnRate(rows, limit),
  }
}

/** 多日聚合主播行 */
export function mergeAnchorRowsForRange(
  snapshots: DailyOperationsAnchorRow[][],
): DailyOperationsAnchorRow[] {
  const map = new Map<string, DailyOperationsAnchorRow>()
  for (const dayRows of snapshots) {
    for (const row of dayRows) {
      const existing = map.get(row.anchorName)
      if (!existing) {
        map.set(row.anchorName, { ...row })
        continue
      }
      existing.validAmountYuan += row.validAmountYuan
      existing.soldOrderCount += row.soldOrderCount
      existing.invalidOrderCount += row.invalidOrderCount
      existing.returnOrderCount += row.returnOrderCount
      existing.liveDurationMinutes += row.liveDurationMinutes
      existing.liveDurationText = formatMergedDuration(existing.liveDurationMinutes)

      const sumNullable = (a: number | null, b: number | null): number | null => {
        if (a == null && b == null) return null
        return (a ?? 0) + (b ?? 0)
      }
      existing.viewSessionCount = sumNullable(existing.viewSessionCount, row.viewSessionCount)
      existing.joinUserCount = sumNullable(existing.joinUserCount, row.joinUserCount)
      existing.newFollowerCount = sumNullable(existing.newFollowerCount, row.newFollowerCount)
      existing.dealUserCount = sumNullable(existing.dealUserCount, row.dealUserCount)

      if (row.shopName && row.shopName !== '—') existing.shopName = row.shopName
    }
  }

  for (const row of map.values()) {
    const hours = safeDivide(row.liveDurationMinutes, 60)
    row.hourlyAmountYuan =
      hours != null && hours > 0 ? Math.round(row.validAmountYuan / hours) : null
    row.avgOrderAmountYuan =
      row.soldOrderCount > 0
        ? Math.round(row.validAmountYuan / row.soldOrderCount)
        : null
    const returnDenom = row.soldOrderCount + row.returnOrderCount
    row.returnOrderRate =
      returnDenom > 0 ? Math.round((row.returnOrderCount / returnDenom) * 100) : null
    row.dealConversionRate =
      row.joinUserCount != null && row.joinUserCount > 0 && row.dealUserCount != null
        ? row.dealUserCount / row.joinUserCount
        : null
    row.newFollowerRate =
      row.viewSessionCount != null &&
      row.viewSessionCount > 0 &&
      row.newFollowerCount != null
        ? row.newFollowerCount / row.viewSessionCount
        : null
  }

  return [...map.values()]
}

function formatMergedDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h > 0 && min > 0) return `${h}小时${min}分`
  if (h > 0) return `${h}小时`
  return `${min}分钟`
}
