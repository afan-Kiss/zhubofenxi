/**
 * 固定场次回退（日期感知）：仅在真实场次/有效排班均未命中时使用。
 * 6 月保留宽时段历史规则；7.1 起严格 早/午/晚班边界 [start, end)。
 */
import { getTimeMinutes } from '../utils/time'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import {
  ANCHOR_NEW_SCHEDULE_START_DATE,
  ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE,
  ANCHOR_XIAOBAI_SCHEDULE_START_DATE,
} from '../config/anchor-schedule.constants'
import { resolveCanonicalShopName } from '../config/qianfan-shops.constants'

export type ShopSessionKey = 'xyxiangyu' | 'xiangyu' | 'hetian' | 'shiyu'

/** 6.13–6.30 宽时段 */
export type LegacyLiveSessionPeriod = 'morning' | 'evening'

/** 7.1 起三班制 */
export type NewLiveSessionPeriod = 'morning' | 'noon' | 'evening'

const XIAOXIAO_XY_MORNING_START = '2026-07-16'
const HETIAN_CHENGCHENG_START_DATE = '2026-07-17'

export function normalizeShopSessionKey(liveAccountName: string): ShopSessionKey | null {
  const n = String(liveAccountName || '').trim()
  if (!n) return null
  const canonical = resolveCanonicalShopName(n)
  if (canonical === 'XY祥钰珠宝') return 'xyxiangyu'
  if (canonical === '祥钰珠宝') return 'xiangyu'
  if (canonical === '拾玉居和田玉') return 'shiyu'
  if (canonical === '和田雅玉') return 'hetian'
  // 兜底：XY 优先于普通祥钰，禁止互相吞并
  if (/XY\s*祥钰/i.test(n) || /xy祥钰/i.test(n)) return 'xyxiangyu'
  if (n.includes('拾玉居')) return 'shiyu'
  if (n.includes('和田雅玉') || n.includes('禾田雅玉')) return 'hetian'
  if (/^祥钰珠宝$/i.test(n) || (/祥钰/.test(n) && !/XY/i.test(n))) return 'xiangyu'
  return null
}

/** 6.13–6.30：00:00–17:59 早场，18:00–23:59 晚场 */
export function resolveLegacyLiveSessionPeriod(date: Date): LegacyLiveSessionPeriod | null {
  const minutes = getTimeMinutes(date)
  if (minutes >= 0 && minutes < 18 * 60) return 'morning'
  if (minutes >= 18 * 60 && minutes <= 23 * 60 + 59) return 'evening'
  return null
}

/**
 * 7.1 起：[09:30,14:00) 早场 / [14:00,18:30) 午场 / [18:30,23:00) 晚场
 * 时段外返回 null → 固定回退不得归属
 */
export function resolveNewLiveSessionPeriod(date: Date): NewLiveSessionPeriod | null {
  const minutes = getTimeMinutes(date)
  if (minutes >= 9 * 60 + 30 && minutes < 14 * 60) return 'morning'
  if (minutes >= 14 * 60 && minutes < 18 * 60 + 30) return 'noon'
  if (minutes >= 18 * 60 + 30 && minutes < 23 * 60) return 'evening'
  return null
}

/** @deprecated 兼容旧调用：无日期时按宽时段 */
export function resolveLiveSessionPeriod(date: Date): LegacyLiveSessionPeriod | null {
  return resolveLegacyLiveSessionPeriod(date)
}

const LEGACY_MAP: Record<
  LegacyLiveSessionPeriod,
  Partial<Record<ShopSessionKey, string>>
> = {
  morning: { xyxiangyu: '子杰', xiangyu: '子杰', hetian: '小红' },
  evening: { shiyu: '飞云', hetian: '小艺' },
}

export function resolveShopSessionFallbackForDate(
  shopKey: ShopSessionKey | null,
  orderCreateMs: number,
): { anchorName: string; period: string; explain: string } | null {
  if (!shopKey || !Number.isFinite(orderCreateMs)) return null
  const at = new Date(orderCreateMs)
  const dateKey = formatDateKeyShanghai(at)

  if (dateKey < ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE) {
    return null
  }

  // 6.13–6.30：宽时段历史规则
  if (dateKey < ANCHOR_NEW_SCHEDULE_START_DATE) {
    const period = resolveLegacyLiveSessionPeriod(at)
    if (!period) return null
    let anchorName = LEGACY_MAP[period][shopKey] ?? null
    // 6.18 起 XY/祥钰 午场段（14:30–18:00）由小白规则优先，这里不抢午场
    if (
      dateKey >= ANCHOR_XIAOBAI_SCHEDULE_START_DATE &&
      (shopKey === 'xyxiangyu' || shopKey === 'xiangyu')
    ) {
      const minutes = getTimeMinutes(at)
      if (minutes >= 14 * 60 + 30 && minutes < 18 * 60) {
        return null // 交给 isXiaoBaiOrderAttribution
      }
      // 早场截止到 14:30
      if (period === 'morning' && minutes >= 14 * 60 + 30) return null
    }
    if (!anchorName) return null
    return {
      anchorName,
      period,
      explain: `固定场次归属：${dateKey} ${period} → ${anchorName}`,
    }
  }

  // 7.1 起：严格三班制
  const period = resolveNewLiveSessionPeriod(at)
  if (!period) return null

  let anchorName: string | null = null
  if (period === 'morning') {
    if (shopKey === 'shiyu') anchorName = '子杰'
    else if (shopKey === 'xyxiangyu' && dateKey >= XIAOXIAO_XY_MORNING_START) anchorName = '小小'
    else if (shopKey === 'hetian') {
      anchorName = dateKey >= HETIAN_CHENGCHENG_START_DATE ? '橙橙' : '小红'
    }
    // 普通祥钰珠宝：7 月无固定早场回退
  } else if (period === 'noon') {
    // 午场 XY → 小白（由专用规则处理）；此处仅和田雅玉
    if (shopKey === 'hetian') {
      anchorName = dateKey >= HETIAN_CHENGCHENG_START_DATE ? '橙橙' : '小艺'
    }
    if (shopKey === 'xyxiangyu' || shopKey === 'xiangyu') {
      return null // 小白专用路径
    }
  } else if (period === 'evening') {
    if (shopKey === 'shiyu') anchorName = '飞云'
    else if (shopKey === 'hetian' && dateKey < HETIAN_CHENGCHENG_START_DATE) {
      anchorName = '小艺'
    }
  }

  if (!anchorName) return null
  return {
    anchorName,
    period,
    explain: `固定场次归属：${dateKey} ${period} → ${anchorName}`,
  }
}

/** 兼容旧签名：按宽/严时段解析主播名 */
export function resolveShopSessionAnchorName(
  shopKey: ShopSessionKey | null,
  period: LegacyLiveSessionPeriod | NewLiveSessionPeriod | null,
  dateKey?: string | null,
): string | null {
  if (!shopKey || !period) return null
  const dk = (dateKey ?? '').trim()
  if (dk && dk >= ANCHOR_NEW_SCHEDULE_START_DATE) {
    // 用中午代表时刻换算，避免调用方仍传 morning/evening 宽语义
    const hm =
      period === 'morning'
        ? '10:00:00'
        : period === 'noon'
          ? '15:00:00'
          : period === 'evening'
            ? '20:00:00'
            : null
    if (!hm) return null
    const ms = Date.parse(`${dk}T${hm}+08:00`)
    return resolveShopSessionFallbackForDate(shopKey, ms)?.anchorName ?? null
  }
  if (period === 'noon') return null
  if (shopKey === 'hetian' && dk && dk >= HETIAN_CHENGCHENG_START_DATE) return '橙橙'
  return LEGACY_MAP[period as LegacyLiveSessionPeriod][shopKey] ?? null
}
