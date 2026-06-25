import type { NormalizedLiveSession } from './xhs-api-sync/xhs-json-normalizer.service'

export interface LiveTrafficDataQuality {
  missingFields: string[]
  fallbackFields: string[]
  officialFields: string[]
  warnings: string[]
}

export interface LiveSessionTrafficMetrics {
  /** 场观人数 */
  viewSessionCount: number | null
  /** 进房人数 */
  joinUserCount: number | null
  /** 平均在线人数 */
  avgOnlineUserCount: number | null
  /** 观众平均停留时长（秒） */
  avgViewDurationSeconds: number | null
  /** 新增粉丝 */
  newFollowerCount: number | null
  /** 成交人数（仅官方 dealUserNum/payUserNum/dealUserCnt） */
  dealUserCount: number | null
}

export interface LiveSessionTrafficExtract extends LiveSessionTrafficMetrics {
  dataQuality: LiveTrafficDataQuality
}

const VIEW_SESSION_KEYS = ['liveViewSessionCnt', 'watchNum', 'liveViewNum', 'viewCnt'] as const
const JOIN_USER_KEYS = [
  'serverLiveViewUserNum',
  'joinUserNum',
  'viewerNum',
  'liveViewUserNum',
  'watchUserNum',
] as const
const NEW_FOLLOWER_KEYS = ['liveFollowUserNum', 'newFollowUserNum', 'followUserNum'] as const
const DEAL_USER_KEYS = ['dealUserNum', 'payUserNum', 'dealUserCnt'] as const

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

function pickLiveRawCountNullable(
  raw: Record<string, unknown>,
  ...keys: readonly string[]
): { value: number | null; key: string | null } {
  for (const k of keys) {
    const v = extractLiveFieldValue(raw, k)
    if (v == null || v === '') continue
    const num = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
    if (Number.isFinite(num)) return { value: Math.round(num), key: k }
  }
  return { value: null, key: null }
}

function pickLiveRawNumber(
  raw: Record<string, unknown>,
  ...keys: readonly string[]
): { value: number | null; key: string | null } {
  return pickLiveRawCountNullable(raw, ...keys)
}

function mergeDataQuality(items: LiveTrafficDataQuality[]): LiveTrafficDataQuality {
  const missingFields = new Set<string>()
  const fallbackFields = new Set<string>()
  const officialFields = new Set<string>()
  const warnings = new Set<string>()
  for (const q of items) {
    q.missingFields.forEach((f) => missingFields.add(f))
    q.fallbackFields.forEach((f) => fallbackFields.add(f))
    q.officialFields.forEach((f) => officialFields.add(f))
    q.warnings.forEach((w) => warnings.add(w))
  }
  return {
    missingFields: [...missingFields],
    fallbackFields: [...fallbackFields],
    officialFields: [...officialFields],
    warnings: [...warnings],
  }
}

function buildFieldQuality(
  label: string,
  picked: { value: number | null; key: string | null },
  keys: readonly string[],
): LiveTrafficDataQuality {
  if (picked.key) {
    return {
      missingFields: [],
      fallbackFields: [],
      officialFields: [`${label}:${picked.key}`],
      warnings: [],
    }
  }
  return {
    missingFields: [label],
    fallbackFields: [],
    officialFields: [],
    warnings: [`官方未返回${label}（候选字段：${keys.join(', ')}）`],
  }
}

export function extractLiveSessionTraffic(
  raw: Record<string, unknown> | undefined,
): LiveSessionTrafficExtract {
  const item = raw ?? {}
  const view = pickLiveRawCountNullable(item, ...VIEW_SESSION_KEYS)
  const join = pickLiveRawCountNullable(item, ...JOIN_USER_KEYS)
  const followers = pickLiveRawCountNullable(item, ...NEW_FOLLOWER_KEYS)
  const dealUsers = pickLiveRawCountNullable(item, ...DEAL_USER_KEYS)
  const avgOnline = pickLiveRawNumber(item, 'avgJoinUv', 'avgOnlineUserNum', 'avgOnlineUv')
  const avgStay = pickLiveRawNumber(item, 'avgViewDuration', 'avgStayDuration', 'perWatchDuration')

  const qualities = [
    buildFieldQuality('viewSessionCount', view, VIEW_SESSION_KEYS),
    buildFieldQuality('joinUserCount', join, JOIN_USER_KEYS),
    buildFieldQuality('newFollowerCount', followers, NEW_FOLLOWER_KEYS),
    buildFieldQuality('dealUserCount', dealUsers, DEAL_USER_KEYS),
    avgOnline.key
      ? {
          missingFields: [],
          fallbackFields: [],
          officialFields: [`avgOnlineUserCount:${avgOnline.key}`],
          warnings: [],
        }
      : buildFieldQuality('avgOnlineUserCount', avgOnline, ['avgJoinUv', 'avgOnlineUserNum']),
    avgStay.key
      ? {
          missingFields: [],
          fallbackFields: [],
          officialFields: [`avgViewDurationSeconds:${avgStay.key}`],
          warnings: [],
        }
      : buildFieldQuality('avgViewDurationSeconds', avgStay, ['avgViewDuration', 'avgStayDuration']),
  ]

  return {
    viewSessionCount: view.value,
    joinUserCount: join.value,
    newFollowerCount: followers.value,
    dealUserCount: dealUsers.value,
    avgOnlineUserCount: avgOnline.value,
    avgViewDurationSeconds: avgStay.value,
    dataQuality: mergeDataQuality(qualities),
  }
}

export function extractLiveSessionTrafficFromSession(
  session: Pick<NormalizedLiveSession, 'raw'>,
): LiveSessionTrafficExtract {
  return extractLiveSessionTraffic(session.raw)
}

export interface AggregatedLiveSessionTraffic extends LiveSessionTrafficMetrics {
  dealConversionRate: number | null
  newFollowerRate: number | null
  dataQuality: LiveTrafficDataQuality
}

function sumNullable(values: Array<number | null>): number | null {
  let sum = 0
  let hasAny = false
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue
    sum += v
    hasAny = true
  }
  return hasAny ? sum : null
}

export function aggregateLiveSessionTraffic(
  items: Array<LiveSessionTrafficMetrics & { dataQuality?: LiveTrafficDataQuality }>,
): AggregatedLiveSessionTraffic {
  const emptyQuality: LiveTrafficDataQuality = {
    missingFields: [],
    fallbackFields: [],
    officialFields: [],
    warnings: [],
  }

  if (items.length === 0) {
    return {
      viewSessionCount: null,
      joinUserCount: null,
      avgOnlineUserCount: null,
      avgViewDurationSeconds: null,
      newFollowerCount: null,
      dealUserCount: null,
      dealConversionRate: null,
      newFollowerRate: null,
      dataQuality: emptyQuality,
    }
  }

  const viewSessionCount = sumNullable(items.map((i) => i.viewSessionCount))
  const joinUserCount = sumNullable(items.map((i) => i.joinUserCount))
  const newFollowerCount = sumNullable(items.map((i) => i.newFollowerCount))
  const dealUserCount = sumNullable(items.map((i) => i.dealUserCount))

  let onlineWeightedSum = 0
  let onlineWeight = 0
  let durationWeightedSum = 0
  let durationWeight = 0

  for (const item of items) {
    const weight = Math.max(1, item.joinUserCount ?? 0)
    if (item.avgOnlineUserCount != null && Number.isFinite(item.avgOnlineUserCount)) {
      onlineWeightedSum += item.avgOnlineUserCount * weight
      onlineWeight += weight
    }
    if (item.avgViewDurationSeconds != null && Number.isFinite(item.avgViewDurationSeconds)) {
      durationWeightedSum += item.avgViewDurationSeconds * weight
      durationWeight += weight
    }
  }

  const dealConversionRate =
    joinUserCount != null && joinUserCount > 0 && dealUserCount != null
      ? dealUserCount / joinUserCount
      : null
  const newFollowerRate =
    viewSessionCount != null && viewSessionCount > 0 && newFollowerCount != null
      ? newFollowerCount / viewSessionCount
      : null

  return {
    viewSessionCount,
    joinUserCount,
    newFollowerCount,
    dealUserCount,
    avgOnlineUserCount: onlineWeight > 0 ? onlineWeightedSum / onlineWeight : null,
    avgViewDurationSeconds: durationWeight > 0 ? durationWeightedSum / durationWeight : null,
    dealConversionRate,
    newFollowerRate,
    dataQuality: mergeDataQuality(items.map((i) => i.dataQuality ?? emptyQuality)),
  }
}

/** 向后兼容：旧代码需要 number 时使用，null 视为 0（仅 legacy 日报汇总） */
export function trafficCountOrZero(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0
}
