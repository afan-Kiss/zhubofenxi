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

/** 直播大屏 ecomlivedata/realtime/metric → room_data_info 关键关键字段 */
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
  ...REALTIME_METRIC_PATCH_KEYS.flatMap(([snake, camel]) => [snake, camel]),
]

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
  for (const [snake, camel] of REALTIME_METRIC_PATCH_KEYS) {
    const v = roomInfo[snake]
    if (v == null || v === '') continue
    patch[snake] = v
    patch[camel] = v
  }
  return { ...raw, ...patch }
}

/** 缺少封面点击率或 60s 停留（解析后有效值）时需要补齐；不得把缺失当 0 */
export function liveRawNeedsRealtimeMetric(raw: Record<string, unknown> | null | undefined): boolean {
  const traffic = extractLiveSessionTraffic(raw ?? undefined)
  return traffic.coverClickRate == null || traffic.stay60sUserCount == null
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

export async function fetchLiveRealtimeMetric(params: {
  roomId: string
  liveAccountId?: string
  liveAccountName?: string
  context?: XhsRequestAuditContext
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
  const res = await requestXhsApi({
    apiKey: 'live_realtime_metric',
    liveAccountId: params.liveAccountId,
    liveAccountName: params.liveAccountName,
    body: { room_id: roomId, only_cur_seller: false },
    refererOverride: `https://ark.xiaohongshu.com/live_screen/operation?roomId=${encodeURIComponent(roomId)}`,
    context: params.context,
  })
  if (!res.ok || !res.data) {
    return {
      ok: false,
      roomInfo: null,
      errorMessage: res.errorMessage ?? `${def.name} 请求失败`,
      httpStatus: res.httpStatus,
    }
  }
  const roomInfo = extractRoomDataInfo(res.data)
  if (!roomInfo) {
    return { ok: false, roomInfo: null, errorMessage: '未解析到 room_data_info' }
  }
  return { ok: true, roomInfo, errorMessage: null }
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

/** 为一批已入库场次补齐大屏封面点击率 / 60s停留等字段（sessionIds = 数据库主键 id） */
export async function enrichLiveSessionsWithRealtimeMetric(params: {
  sessionIds: string[]
  liveAccountId?: string
  liveAccountName?: string
  context?: XhsRequestAuditContext
  maxRequests?: number
  /** 成功写入后是否失效经营缓存，默认 true */
  invalidateCache?: boolean
}): Promise<EnrichLiveRealtimeMetricResult> {
  const maxRequests = params.maxRequests ?? 40
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
    select: { id: true, liveId: true, rawJson: true },
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

    attempted++
    const fetched = await fetchLiveRealtimeMetric({
      roomId: liveId,
      liveAccountId: params.liveAccountId,
      liveAccountName: params.liveAccountName,
      context: params.context,
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
      continue
    }
    try {
      const merged = mergeRealtimeMetricIntoLiveRaw(raw, fetched.roomInfo)
      await persistMergedRaw(row.id, merged)
      enriched++
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
