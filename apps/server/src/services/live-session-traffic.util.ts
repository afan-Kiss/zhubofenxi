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
  /** 封面点击率（0–1，来自 live_ctr / liveCtr） */
  coverClickRate: number | null
  /** 60s 停留人数 */
  stay60sUserCount: number | null
  /** 曝光次数 */
  impressionCount: number | null
  /** 观看支付率（0–1，来自 viewPayRate / join_conversion_rate） */
  viewPayRate: number | null
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
  'join_uv',
] as const
const NEW_FOLLOWER_KEYS = ['liveFollowUserNum', 'newFollowUserNum', 'followUserNum'] as const
const DEAL_USER_KEYS = ['dealUserNum', 'payUserNum', 'dealUserCnt'] as const
const COVER_CLICK_RATE_KEYS = ['liveCtr', 'live_ctr', 'coverClickRate'] as const
const STAY_60S_KEYS = [
  'liveViewOver60sUserNum',
  'live_view_over60s_user_num',
  'stay60sUserNum',
] as const
const IMPRESSION_KEYS = [
  'liveTotalImpressionCnt',
  'live_total_impression_cnt',
  'impressionCnt',
] as const
const VIEW_PAY_RATE_KEYS = [
  'viewPayRate',
  'join_conversion_rate',
  'viewDealRate',
  'watchPayRate',
] as const
const AVG_STAY_KEYS = [
  'avgViewDuration',
  'viewer_duration_avg',
  'avgStayDuration',
  'perWatchDuration',
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

/**
 * 收集 CTR / 比率字段可能出现的嵌套对象（扁平 raw + room_data_info 等）。
 * 不修改原 raw。
 */
export function collectLiveMetricSourceRecords(
  raw: Record<string, unknown> | undefined,
): Array<{ path: string; record: Record<string, unknown> }> {
  const root = raw ?? {}
  const out: Array<{ path: string; record: Record<string, unknown> }> = [{ path: 'raw', record: root }]

  const tryPush = (path: string, value: unknown) => {
    const rec = asRecord(value)
    if (rec) out.push({ path, record: rec })
  }

  tryPush('raw.room_data_info', root.room_data_info)
  tryPush('raw.data', root.data)
  const data = asRecord(root.data)
  if (data) tryPush('raw.data.room_data_info', data.room_data_info)
  tryPush('raw.realtimeMetric', root.realtimeMetric)
  const realtime = asRecord(root.realtimeMetric)
  if (realtime) tryPush('raw.realtimeMetric.room_data_info', realtime.room_data_info)

  return out
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

/** 解析比率：0–1 小数、0–100 百分数、带 % 字符串 */
export function parseLiveRateValue(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    if (o.value != null && o.value !== '') return parseLiveRateValue(o.value)
    if (o.displayValue != null && o.displayValue !== '') return parseLiveRateValue(o.displayValue)
    return null
  }
  const raw = String(value).trim()
  const hasPercent = raw.includes('%')
  const num = typeof value === 'number' ? value : Number(raw.replace(/%/g, '').replace(/,/g, ''))
  if (!Number.isFinite(num)) return null
  if (hasPercent) {
    if (num < 0 || num > 100) return null
    return num / 100
  }
  if (num > 1 && num <= 100) return num / 100
  if (num >= 0 && num <= 1) return num
  return null
}

function pickLiveRawCountNullable(
  raw: Record<string, unknown>,
  ...keys: readonly string[]
): { value: number | null; key: string | null } {
  for (const { path, record } of collectLiveMetricSourceRecords(raw)) {
    for (const k of keys) {
      const v = extractLiveFieldValue(record, k)
      if (v == null || v === '') continue
      const num = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
      if (Number.isFinite(num)) {
        return { value: Math.round(num), key: path === 'raw' ? k : `${path}.${k}` }
      }
    }
  }
  return { value: null, key: null }
}

function pickLiveRawNumber(
  raw: Record<string, unknown>,
  ...keys: readonly string[]
): { value: number | null; key: string | null } {
  return pickLiveRawCountNullable(raw, ...keys)
}

/** 比率字段：支持嵌套 room_data_info、value/displayValue 包装 */
function pickLiveRawRate(
  raw: Record<string, unknown>,
  ...keys: readonly string[]
): { value: number | null; key: string | null } {
  for (const { path, record } of collectLiveMetricSourceRecords(raw)) {
    for (const k of keys) {
      const v = extractLiveFieldValue(record, k)
      if (v == null || v === '') continue
      const parsed = parseLiveRateValue(v)
      if (parsed == null) continue
      return { value: parsed, key: path === 'raw' ? k : `${path}.${k}` }
    }
  }
  return { value: null, key: null }
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
  const avgStay = pickLiveRawNumber(item, ...AVG_STAY_KEYS)
  const coverClick = pickLiveRawRate(item, ...COVER_CLICK_RATE_KEYS)
  const stay60s = pickLiveRawCountNullable(item, ...STAY_60S_KEYS)
  const impression = pickLiveRawCountNullable(item, ...IMPRESSION_KEYS)
  const viewPay = pickLiveRawRate(item, ...VIEW_PAY_RATE_KEYS)

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
      : buildFieldQuality('avgViewDurationSeconds', avgStay, AVG_STAY_KEYS),
    buildFieldQuality('coverClickRate', coverClick, COVER_CLICK_RATE_KEYS),
    buildFieldQuality('stay60sUserCount', stay60s, STAY_60S_KEYS),
    buildFieldQuality('impressionCount', impression, IMPRESSION_KEYS),
    buildFieldQuality('viewPayRate', viewPay, VIEW_PAY_RATE_KEYS),
  ]

  return {
    viewSessionCount: view.value,
    joinUserCount: join.value,
    newFollowerCount: followers.value,
    dealUserCount: dealUsers.value,
    avgOnlineUserCount: avgOnline.value,
    avgViewDurationSeconds: avgStay.value,
    coverClickRate: coverClick.value,
    stay60sUserCount: stay60s.value,
    impressionCount: impression.value,
    viewPayRate: viewPay.value,
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

function weightedAverage(
  items: Array<{ value: number | null; weight: number }>,
): number | null {
  let sum = 0
  let weight = 0
  for (const item of items) {
    if (item.value == null || !Number.isFinite(item.value)) continue
    const w = Math.max(1, item.weight)
    sum += item.value * w
    weight += w
  }
  return weight > 0 ? sum / weight : null
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
      coverClickRate: null,
      stay60sUserCount: null,
      impressionCount: null,
      viewPayRate: null,
      dealConversionRate: null,
      newFollowerRate: null,
      dataQuality: emptyQuality,
    }
  }

  const viewSessionCount = sumNullable(items.map((i) => i.viewSessionCount))
  const joinUserCount = sumNullable(items.map((i) => i.joinUserCount))
  const newFollowerCount = sumNullable(items.map((i) => i.newFollowerCount))
  const dealUserCount = sumNullable(items.map((i) => i.dealUserCount))
  const stay60sUserCount = sumNullable(items.map((i) => i.stay60sUserCount))
  const impressionCount = sumNullable(items.map((i) => i.impressionCount))

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
    stay60sUserCount,
    impressionCount,
    avgOnlineUserCount: onlineWeight > 0 ? onlineWeightedSum / onlineWeight : null,
    avgViewDurationSeconds: durationWeight > 0 ? durationWeightedSum / durationWeight : null,
    coverClickRate: weightedAverage(
      items.map((i) => ({
        value: i.coverClickRate,
        weight: Math.max(1, i.impressionCount ?? i.viewSessionCount ?? 0),
      })),
    ),
    viewPayRate: weightedAverage(
      items.map((i) => ({
        value: i.viewPayRate,
        weight: Math.max(1, i.joinUserCount ?? i.viewSessionCount ?? 0),
      })),
    ),
    dealConversionRate,
    newFollowerRate,
    dataQuality: mergeDataQuality(items.map((i) => i.dataQuality ?? emptyQuality)),
  }
}

/** 封面点击率是否合格（≥7%） */
export const COVER_CLICK_RATE_PASS_THRESHOLD = 0.07

export function isCoverClickRateQualified(rate: number | null | undefined): boolean | null {
  if (rate == null || !Number.isFinite(rate)) return null
  return rate >= COVER_CLICK_RATE_PASS_THRESHOLD
}

/** 向后兼容：旧代码需要 number 时使用，null 视为 0（仅 legacy 日报汇总） */
export function trafficCountOrZero(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0
}
