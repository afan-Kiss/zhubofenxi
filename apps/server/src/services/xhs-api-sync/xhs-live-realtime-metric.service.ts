import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type { XhsRequestAuditContext } from '../xhs-http.service'
import { getApiDefinition, isApiConfigured } from './xhs-api-registry'
import { requestXhsApi } from './xhs-api-client.service'

/** 直播大屏 ecomlivedata/realtime/metric → room_data_info 关键关键字段 */
const REALTIME_METRIC_PATCH_KEYS = [
  ['live_ctr', 'liveCtr'],
  ['live_view_over60s_user_num', 'liveViewOver60sUserNum'],
  ['live_total_impression_cnt', 'liveTotalImpressionCnt'],
  ['join_conversion_rate', 'viewPayRate'],
  ['viewer_duration_avg', 'avgViewDuration'],
  ['join_uv', 'serverLiveViewUserNum'],
] as const

export function extractRoomDataInfo(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const data = root.data
  if (!data || typeof data !== 'object') return null
  const info = (data as Record<string, unknown>).room_data_info
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null
  return info as Record<string, unknown>
}

/** 把大屏 realtime/metric 字段合并进场次 rawJson（不覆盖已有非空官方包装值时仍写入扁平别名） */
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

export function liveRawNeedsRealtimeMetric(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw) return true
  const hasCtr = raw.live_ctr != null || raw.liveCtr != null
  const hasStay60 = raw.live_view_over60s_user_num != null || raw.liveViewOver60sUserNum != null
  return !(hasCtr && hasStay60)
}

export async function fetchLiveRealtimeMetric(params: {
  roomId: string
  liveAccountId?: string
  liveAccountName?: string
  context?: XhsRequestAuditContext
}): Promise<{ ok: boolean; roomInfo: Record<string, unknown> | null; errorMessage: string | null }> {
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
    return { ok: false, roomInfo: null, errorMessage: res.errorMessage ?? `${def.name} 请求失败` }
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

/** 为一批已入库场次补齐大屏封面点击率 / 60s停留等字段 */
export async function enrichLiveSessionsWithRealtimeMetric(params: {
  sessionIds: string[]
  liveAccountId?: string
  liveAccountName?: string
  context?: XhsRequestAuditContext
  maxRequests?: number
}): Promise<{ attempted: number; enriched: number; skipped: number; warnings: string[] }> {
  const maxRequests = params.maxRequests ?? 40
  const warnings: string[] = []
  let attempted = 0
  let enriched = 0
  let skipped = 0

  if (!isApiConfigured('live_realtime_metric') || params.sessionIds.length === 0) {
    return { attempted, enriched, skipped, warnings }
  }

  const rows = await prisma.xhsRawLiveSession.findMany({
    where: { id: { in: params.sessionIds } },
    select: { id: true, liveId: true, rawJson: true },
  })

  for (const row of rows) {
    if (attempted >= maxRequests) {
      warnings.push(`大屏指标补齐已达上限 ${maxRequests}，其余场次跳过`)
      break
    }
    const liveId = (row.liveId ?? '').trim()
    if (!liveId) {
      skipped++
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
      warnings.push(`${liveId}: ${fetched.errorMessage ?? '补齐失败'}`)
      continue
    }
    const merged = mergeRealtimeMetricIntoLiveRaw(raw, fetched.roomInfo)
    await persistMergedRaw(row.id, merged)
    enriched++
  }

  return { attempted, enriched, skipped, warnings }
}
