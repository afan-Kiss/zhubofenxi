import type { NormalizedLiveSession } from './xhs-api-sync/xhs-json-normalizer.service'

export interface LiveSessionTrafficMetrics {
  /** 场观人数 */
  viewSessionCount: number
  /** 进房人数 */
  joinUserCount: number
  /** 平均在线人数 */
  avgOnlineUserCount: number | null
  /** 观众平均停留时长（秒） */
  avgViewDurationSeconds: number | null
  /** 新增粉丝 */
  newFollowerCount: number
  /** 成交人数 */
  dealUserCount: number
}

function extractLiveFieldValue(item: Record<string, unknown>, fieldName: string): unknown {
  const field = item[fieldName]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    if (f.value !== undefined && f.value !== null && String(f.value).trim() !== '') {
      return f.value
    }
    if (f.displayValue !== undefined && f.displayValue !== null && String(f.displayValue).trim() !== '') {
      return f.displayValue
    }
  }
  return item[fieldName]
}

function pickLiveRawCount(raw: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = extractLiveFieldValue(raw, k)
    if (v == null || v === '') continue
    const num = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
    if (Number.isFinite(num)) return Math.round(num)
  }
  return 0
}

function pickLiveRawNumber(raw: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = extractLiveFieldValue(raw, k)
    if (v == null || v === '') continue
    const num = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
    if (Number.isFinite(num)) return num
  }
  return null
}

export function extractLiveSessionTraffic(
  raw: Record<string, unknown> | undefined,
): LiveSessionTrafficMetrics {
  const item = raw ?? {}
  return {
    viewSessionCount: pickLiveRawCount(
      item,
      'liveViewSessionCnt',
      'watchNum',
      'liveViewNum',
      'viewCnt',
    ),
    joinUserCount: pickLiveRawCount(
      item,
      'serverLiveViewUserNum',
      'joinUserNum',
      'viewerNum',
      'liveViewUserNum',
      'watchUserNum',
    ),
    avgOnlineUserCount: pickLiveRawNumber(item, 'avgJoinUv', 'avgOnlineUserNum', 'avgOnlineUv'),
    avgViewDurationSeconds: pickLiveRawNumber(
      item,
      'avgViewDuration',
      'avgStayDuration',
      'perWatchDuration',
    ),
    newFollowerCount: pickLiveRawCount(item, 'liveFollowUserNum', 'newFollowUserNum', 'followUserNum'),
    dealUserCount: pickLiveRawCount(item, 'dealUserNum', 'payUserNum', 'dealUserCnt'),
  }
}

export function extractLiveSessionTrafficFromSession(
  session: Pick<NormalizedLiveSession, 'raw' | 'dealOrderCount'>,
): LiveSessionTrafficMetrics {
  const traffic = extractLiveSessionTraffic(session.raw)
  if (traffic.dealUserCount <= 0 && session.dealOrderCount > 0) {
    return { ...traffic, dealUserCount: session.dealOrderCount }
  }
  return traffic
}

export interface AggregatedLiveSessionTraffic extends LiveSessionTrafficMetrics {
  dealConversionRate: number | null
  newFollowerRate: number | null
}

export function aggregateLiveSessionTraffic(
  items: LiveSessionTrafficMetrics[],
): AggregatedLiveSessionTraffic {
  if (items.length === 0) {
    return {
      viewSessionCount: 0,
      joinUserCount: 0,
      avgOnlineUserCount: null,
      avgViewDurationSeconds: null,
      newFollowerCount: 0,
      dealUserCount: 0,
      dealConversionRate: null,
      newFollowerRate: null,
    }
  }

  let viewSessionCount = 0
  let joinUserCount = 0
  let newFollowerCount = 0
  let dealUserCount = 0
  let onlineWeightedSum = 0
  let onlineWeight = 0
  let durationWeightedSum = 0
  let durationWeight = 0

  for (const item of items) {
    viewSessionCount += item.viewSessionCount
    joinUserCount += item.joinUserCount
    newFollowerCount += item.newFollowerCount
    dealUserCount += item.dealUserCount
    const weight = Math.max(1, item.joinUserCount)
    if (item.avgOnlineUserCount != null && Number.isFinite(item.avgOnlineUserCount)) {
      onlineWeightedSum += item.avgOnlineUserCount * weight
      onlineWeight += weight
    }
    if (item.avgViewDurationSeconds != null && Number.isFinite(item.avgViewDurationSeconds)) {
      durationWeightedSum += item.avgViewDurationSeconds * weight
      durationWeight += weight
    }
  }

  return {
    viewSessionCount,
    joinUserCount,
    newFollowerCount,
    dealUserCount,
    avgOnlineUserCount: onlineWeight > 0 ? onlineWeightedSum / onlineWeight : null,
    avgViewDurationSeconds: durationWeight > 0 ? durationWeightedSum / durationWeight : null,
    dealConversionRate:
      joinUserCount > 0 ? dealUserCount / joinUserCount : null,
    newFollowerRate:
      viewSessionCount > 0 ? newFollowerCount / viewSessionCount : null,
  }
}
