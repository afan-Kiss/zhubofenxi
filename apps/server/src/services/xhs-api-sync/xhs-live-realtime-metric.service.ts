/**
 * 直播大屏 realtime/metric 字段：补齐、合并、需求判定
 * 来源：ecomlivedata/realtime/metric → data.room_data_info
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type { XhsRequestAuditContext } from '../xhs-http.service'
import { extractLiveSessionTraffic } from '../live-session-traffic.util'
import { getApiDefinition, isApiConfigured } from './xhs-api-registry'
import { requestXhsApi } from './xhs-api-client.service'
import { GOOD_REVIEW_SHOPS } from '../../config/good-review-shops.constants'
import { resolveOfficialShopAccount } from '../official-shop-account.service'
import { buildShopLiveSessionWhere } from './xhs-live-session-query.util'
import { endOfDayMsShanghai, startOfDayMsShanghai } from '../../utils/business-timezone'

/** 直播大屏 ecomlivedata/realtime/metric → room_data_info 的重点字段 */
export const REALTIME_METRIC_PATCH_KEYS = [
  ['live_ctr', 'liveCtr'],
  ['live_view_over60s_user_num', 'liveViewOver60sUserNum'],
  ['live_total_impression_cnt', 'liveTotalImpressionCnt'],
  ['join_conversion_rate', 'viewPayRate'],
  ['viewer_duration_avg', 'avgViewDuration'],
  ['join_uv', 'serverLiveViewUserNum'],
] as const

/** 场次列表 upsert 时需保留的大屏补齐字段（避免 sellerLiveDetailData 覆盖） */
export const REALTIME_METRIC_PRESERVE_KEYS: string[] = [
  '_realtimeMetricSyncedAt',
  '_realtimeMetricFailedAt',
  ...REALTIME_METRIC_PATCH_KEYS.flatMap(([snake, camel]) => [snake, camel]),
]

/** 同一场次短时内不重复打大屏接口（成功空字段或失败后冷却） */
export const REALTIME_METRIC_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000

const ensureInflightByDate = new Map<string, Promise<EnrichLiveRealtimeMetricResult>>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function extractRoomDataInfo(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const data = root.data
  if (!data || typeof data !== 'object') return null
  const info = (data as Record<string, unknown>).room_data_info
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null
  return info as Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

/**
 * 列表同步写入 rawJson 时保留已补齐的大屏指标，避免把 live_ctr / 60s 等冲掉。
 * 入站 item 已有非空同名键时以入站为准。
 */
export function mergePreserveRealtimeMetricFields(
  existingRaw: unknown,
  incomingItem: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incomingItem }
  const prev = asRecord(existingRaw)
  if (!prev) return out
  for (const key of REALTIME_METRIC_PRESERVE_KEYS) {
    const nextVal = out[key]
    const emptyNext = nextVal == null || nextVal === ''
    if (!emptyNext) continue
    const prevVal = prev[key]
    if (prevVal == null || prevVal === '') continue
    out[key] = prevVal
  }
  return out
}

/** 把大屏 realtime/metric 字段合并进场次 rawJson */
export function mergeRealtimeMetricIntoLiveRaw(
  raw: Record<string, unknown>,
  roomInfo: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    _realtimeMetricSyncedAt: new Date().toISOString(),
  }
  // 成功拿到 room_data_info 即清掉失败戳，即便个别字段仍空（短场次）
  const { _realtimeMetricFailedAt: _drop, ...rest } = raw
  void _drop
  for (const [snake, camel] of REALTIME_METRIC_PATCH_KEYS) {
    const v = roomInfo[snake]
    if (v == null || v === '') continue
    patch[snake] = v
    patch[camel] = v
  }
  return { ...rest, ...patch }
}

/** 缺少封面点击率或 60s 停留（解析后有效值）时需要补齐；不得把缺失当 0 */
export function liveRawNeedsRealtimeMetric(raw: Record<string, unknown> | null | undefined): boolean {
  const traffic = extractLiveSessionTraffic(raw ?? undefined)
  return traffic.coverClickRate == null || traffic.stay60sUserCount == null
}

/**
 * 是否应再请求大屏接口：字段仍缺，且距上次成功/失败未在冷却期内。
 * 避免日报反复打开时对永久无字段的短场次疯狂打接口。
 */
export function liveRawShouldFetchRealtimeMetric(
  raw: Record<string, unknown> | null | undefined,
  nowMs: number = Date.now(),
  cooldownMs: number = REALTIME_METRIC_RETRY_COOLDOWN_MS,
): boolean {
  if (!liveRawNeedsRealtimeMetric(raw)) return false
  const rec = asRecord(raw) ?? {}
  const lastAttemptMs = Math.max(
    parseIsoMs(rec._realtimeMetricSyncedAt) ?? 0,
    parseIsoMs(rec._realtimeMetricFailedAt) ?? 0,
  )
  if (lastAttemptMs > 0 && nowMs - lastAttemptMs < cooldownMs) return false
  return true
}

function classifyRealtimeMetricFailure(params: {
  liveId: string
  errorMessage: string | null
  httpStatus?: number
}): string {
  const msg = (params.errorMessage ?? '').trim()
  const status = params.httpStatus
  if (!params.liveId.trim()) return 'roomId无效'
  if (msg.includes('未配置')) return '接口未配置'
  if (status === 401 || status === 403 || /cookie|登录|鉴权|权限/i.test(msg)) {
    return `Cookie失效或权限不足${status ? `（HTTP ${status}）` : ''}${msg ? `：${msg}` : ''}`
  }
  if (status === 429 || status === 406) {
    return `触发限流（HTTP ${status}）`
  }
  if (msg.includes('room_data_info') || msg.includes('未解析到')) {
    return '响应无 room_data_info'
  }
  if (/roomId|房间/.test(msg)) return `roomId无效：${msg}`
  return msg || '补齐失败'
}

function isTransientRealtimeMetricFailure(httpStatus?: number, errorMessage?: string | null): boolean {
  if (httpStatus === 429 || httpStatus === 406 || httpStatus === 502 || httpStatus === 503) return true
  const msg = (errorMessage ?? '').toLowerCase()
  return /timeout|econnreset|socket|限流|too many|network/i.test(msg)
}

export async function fetchLiveRealtimeMetric(params: {
  roomId: string
  liveAccountId?: string
  liveAccountName?: string
  context?: XhsRequestAuditContext
  /** 含首次，默认 2（失败可再试 1 次） */
  maxAttempts?: number
}): Promise<{
  ok: boolean
  roomInfo: Record<string, unknown> | null
  errorMessage: string | null
  httpStatus?: number
}> {
  if (!isApiConfigured('live_realtime_metric')) {
    return { ok: false, roomInfo: null, errorMessage: '直播大屏实时指标接口未配置' }
  }
  const roomId = params.roomId.trim()
  if (!roomId) return { ok: false, roomInfo: null, errorMessage: 'roomId 为空' }

  const def = getApiDefinition('live_realtime_metric')
  const maxAttempts = Math.max(1, params.maxAttempts ?? 2)
  let lastError: string | null = null
  let lastStatus: number | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await requestXhsApi({
      apiKey: 'live_realtime_metric',
      liveAccountId: params.liveAccountId,
      liveAccountName: params.liveAccountName,
      body: { room_id: roomId, only_cur_seller: false },
      refererOverride: `https://ark.xiaohongshu.com/live_screen/operation?roomId=${encodeURIComponent(roomId)}`,
      context: params.context,
    })
    if (res.ok && res.data) {
      const roomInfo = extractRoomDataInfo(res.data)
      if (!roomInfo) {
        return { ok: false, roomInfo: null, errorMessage: '未解析到 room_data_info' }
      }
      return { ok: true, roomInfo, errorMessage: null }
    }
    lastError = res.errorMessage ?? `${def.name} 请求失败`
    lastStatus = res.httpStatus
    if (attempt < maxAttempts && isTransientRealtimeMetricFailure(lastStatus, lastError)) {
      await sleep(400 * attempt)
      continue
    }
    break
  }

  return {
    ok: false,
    roomInfo: null,
    errorMessage: lastError,
    httpStatus: lastStatus,
  }
}

async function persistMergedRaw(sessionId: string, merged: Record<string, unknown>): Promise<void> {
  await prisma.xhsRawLiveSession.update({
    where: { id: sessionId },
    data: { rawJson: merged as Prisma.InputJsonValue },
  })
}

export interface EnrichLiveRealtimeMetricResult {
  attempted: number
  enriched: number
  skipped: number
  failed: number
  warnings: string[]
}

function emptyEnrichResult(): EnrichLiveRealtimeMetricResult {
  return { attempted: 0, enriched: 0, skipped: 0, failed: 0, warnings: [] }
}

function mergeEnrichResults(
  parts: EnrichLiveRealtimeMetricResult[],
): EnrichLiveRealtimeMetricResult {
  const out = emptyEnrichResult()
  for (const p of parts) {
    out.attempted += p.attempted
    out.enriched += p.enriched
    out.skipped += p.skipped
    out.failed += p.failed
    out.warnings.push(...p.warnings)
  }
  return out
}

/** 为一批已入库场次补齐大屏封面点击率 / 60s停留等字段（sessionIds = 数据库主键 id） */
export async function enrichLiveSessionsWithRealtimeMetric(params: {
  sessionIds: string[]
  liveAccountId?: string
  liveAccountName?: string
  context?: XhsRequestAuditContext
  maxRequests?: number
  /** 成功写入后是否失效经营缓存，默认 true */
  invalidateCache?: boolean
  /** 是否尊重冷却期（日报补齐默认 true；同步可 false 强制扫本批） */
  respectCooldown?: boolean
  /** 请求间隔，降低限流，默认 120ms */
  requestGapMs?: number
}): Promise<EnrichLiveRealtimeMetricResult> {
  const maxRequests = params.maxRequests ?? 80
  const respectCooldown = params.respectCooldown !== false
  const requestGapMs = Math.max(0, params.requestGapMs ?? 120)
  const warnings: string[] = []
  let attempted = 0
  let enriched = 0
  let skipped = 0
  let failed = 0

  if (params.sessionIds.length === 0) {
    return { attempted, enriched, skipped, failed, warnings }
  }

  if (!isApiConfigured('live_realtime_metric')) {
    warnings.push('直播大屏实时指标接口未配置，跳过补齐')
    return { attempted, enriched, skipped, failed: params.sessionIds.length, warnings }
  }

  const uniqueIds = [...new Set(params.sessionIds.filter((id) => id.trim()))]
  const rows = await prisma.xhsRawLiveSession.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, liveId: true, rawJson: true, liveAccountId: true, liveAccountName: true },
  })

  const found = new Set(rows.map((r) => r.id))
  for (const id of uniqueIds) {
    if (!found.has(id)) {
      failed++
      warnings.push(`${id}: 数据库场次不存在（请确认传入的是 session 主键而非平台 liveId）`)
    }
  }

  for (const row of rows) {
    if (attempted >= maxRequests) {
      warnings.push(`大屏指标补齐已达上限 ${maxRequests}，其余场次跳过`)
      break
    }
    const liveId = (row.liveId ?? '').trim()
    if (!liveId) {
      skipped++
      warnings.push(`${row.id}: roomId无效（liveId 为空）`)
      continue
    }
    const raw =
      row.rawJson && typeof row.rawJson === 'object' && !Array.isArray(row.rawJson)
        ? (row.rawJson as Record<string, unknown>)
        : {}
    if (!liveRawNeedsRealtimeMetric(raw)) {
      skipped++
      continue
    }
    if (respectCooldown && !liveRawShouldFetchRealtimeMetric(raw)) {
      skipped++
      continue
    }

    attempted++
    if (attempted > 1 && requestGapMs > 0) {
      await sleep(requestGapMs)
    }

    const accountId = (params.liveAccountId ?? row.liveAccountId ?? '').trim() || undefined
    const accountName =
      (params.liveAccountName ?? row.liveAccountName ?? '').trim() || undefined

    const fetched = await fetchLiveRealtimeMetric({
      roomId: liveId,
      liveAccountId: accountId,
      liveAccountName: accountName,
      context: params.context,
      maxAttempts: 2,
    })
    if (!fetched.ok || !fetched.roomInfo) {
      failed++
      warnings.push(
        `${liveId}: ${classifyRealtimeMetricFailure({
          liveId,
          errorMessage: fetched.errorMessage,
          httpStatus: fetched.httpStatus,
        })}`,
      )
      try {
        await persistMergedRaw(row.id, {
          ...raw,
          _realtimeMetricFailedAt: new Date().toISOString(),
        })
      } catch {
        // ignore stamp failure
      }
      continue
    }
    try {
      const merged = mergeRealtimeMetricIntoLiveRaw(raw, fetched.roomInfo)
      await persistMergedRaw(row.id, merged)
      // 接口成功但字段仍空：已 stamp syncedAt，冷却期内不再打；有字段则 enriched++
      if (!liveRawNeedsRealtimeMetric(merged)) {
        enriched++
      } else {
        skipped++
        warnings.push(`${liveId}: 大屏已响应但封面点击率/60s仍空（短场次或平台未产出）`)
      }
    } catch (err) {
      failed++
      warnings.push(
        `${liveId}: 写库失败 ${err instanceof Error ? err.message : String(err)}`.slice(0, 160),
      )
    }
  }

  if (enriched > 0 && params.invalidateCache !== false) {
    try {
      const { invalidateBusinessBoardCache } = await import('../business-cache.service')
      invalidateBusinessBoardCache()
    } catch {
      warnings.push('大屏指标已写入，但经营缓存失效失败')
    }
  }

  return { attempted, enriched, skipped, failed, warnings }
}

/**
 * 日报打开前：按四店补齐当日缺失的封面点击率 / 60s 停留。
 * 同日期并发请求合并；冷却期内不重复打平台。
 */
export async function ensureLiveRealtimeMetricsForReportDate(
  reportDate: string,
  options?: {
    context?: XhsRequestAuditContext
    maxRequestsPerShop?: number
    force?: boolean
  },
): Promise<EnrichLiveRealtimeMetricResult> {
  const dateKey = reportDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return { ...emptyEnrichResult(), warnings: [`无效日报日期: ${reportDate}`] }
  }

  const existing = ensureInflightByDate.get(dateKey)
  if (existing && !options?.force) return existing

  const run = (async (): Promise<EnrichLiveRealtimeMetricResult> => {
    if (!isApiConfigured('live_realtime_metric')) {
      return {
        ...emptyEnrichResult(),
        warnings: ['直播大屏实时指标接口未配置，跳过日报补齐'],
      }
    }

    const startMs = startOfDayMsShanghai(dateKey)
    const endMs = endOfDayMsShanghai(dateKey)
    const maxPerShop = options?.maxRequestsPerShop ?? 40
    const parts: EnrichLiveRealtimeMetricResult[] = []

    for (const shop of GOOD_REVIEW_SHOPS) {
      const account = await resolveOfficialShopAccount(shop.shopKey)
      if (!account) {
        parts.push({
          ...emptyEnrichResult(),
          warnings: [`${shop.shopName}: 无官方账号，跳过大屏补齐`],
        })
        continue
      }

      const rows = await prisma.xhsRawLiveSession.findMany({
        where: buildShopLiveSessionWhere({
          officialAccountId: account.id,
          shopKey: shop.shopKey,
          shopName: shop.shopName,
          startTimeGte: new Date(startMs - 3 * 60 * 60 * 1000),
          startTimeLte: new Date(endMs + 3 * 60 * 60 * 1000),
        }),
        select: { id: true, startTime: true, rawJson: true },
      })

      const needIds: string[] = []
      for (const row of rows) {
        const st = row.startTime?.getTime?.() ?? NaN
        if (!Number.isFinite(st) || st < startMs || st > endMs) continue
        const raw = asRecord(row.rawJson) ?? {}
        if (options?.force ? liveRawNeedsRealtimeMetric(raw) : liveRawShouldFetchRealtimeMetric(raw)) {
          needIds.push(row.id)
        }
      }

      if (needIds.length === 0) {
        parts.push(emptyEnrichResult())
        continue
      }

      parts.push(
        await enrichLiveSessionsWithRealtimeMetric({
          sessionIds: needIds,
          liveAccountId: account.id,
          liveAccountName: account.displayName ?? shop.shopName,
          context: options?.context ?? {
            module: `daily_report_ensure_realtime_metric:${dateKey}:${shop.shopKey}`,
          },
          maxRequests: maxPerShop,
          invalidateCache: true,
          respectCooldown: !options?.force,
          requestGapMs: 150,
        }),
      )
    }

    const merged = mergeEnrichResults(parts)
    if (merged.attempted > 0 || merged.warnings.length > 0) {
      console.log(
        '[daily-report-realtime-metric]',
        JSON.stringify({
          reportDate: dateKey,
          attempted: merged.attempted,
          enriched: merged.enriched,
          skipped: merged.skipped,
          failed: merged.failed,
          warningCount: merged.warnings.length,
        }),
      )
    }
    return merged
  })()

  ensureInflightByDate.set(dateKey, run)
  try {
    return await run
  } finally {
    // 保留短时缓存，避免连点日报反复打满接口；60s 后允许再确保
    setTimeout(() => {
      if (ensureInflightByDate.get(dateKey) === run) {
        ensureInflightByDate.delete(dateKey)
      }
    }, 60_000).unref?.()
  }
}
