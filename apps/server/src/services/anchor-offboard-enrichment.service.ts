/**
 * 主播业绩榜：已离职标记（长周期卡片展示「已离职」水印，与单日「休假」并列）。
 */
import { findAnchorForAttributionByName } from './anchor.service'
import {
  isBusinessDateKey,
  shanghaiTodayDateKey,
} from '../utils/anchor-effective-date.util'

export function isAnchorOffboardedAsOf(
  anchor: {
    enabled?: boolean
    effectiveTo?: string | null
    deletedAt?: string | Date | null
  } | null | undefined,
  asOfDate: string,
): boolean {
  if (!anchor || !isBusinessDateKey(asOfDate)) return false
  if (anchor.deletedAt) return true
  if (anchor.enabled === false) return true
  const to = String(anchor.effectiveTo ?? '').trim()
  if (isBusinessDateKey(to) && asOfDate > to) return true
  return false
}

/**
 * 为业绩榜行写入 isOffboarded。
 * 以「查询结束日」与「今天」取较晚者判断是否已离职，避免本月/上月看历史仍漏标。
 */
export function enrichAnchorLeaderboardWithOffboardStatus(
  rows: Array<Record<string, unknown>>,
  params: { startDate: string; endDate: string },
): Array<Record<string, unknown>> {
  const today = shanghaiTodayDateKey()
  const end = isBusinessDateKey(params.endDate) ? params.endDate : today
  const asOf = end > today ? end : today

  return rows.map((row) => {
    const name = String(row.anchorName ?? '').trim()
    if (!name || name === '未归属') {
      return { ...row, isOffboarded: false }
    }
    const found = findAnchorForAttributionByName(name)
    const isOffboarded = isAnchorOffboardedAsOf(found, asOf)
    return { ...row, isOffboarded }
  })
}
