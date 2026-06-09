import type { AnalyzedOrderView, AnchorConfig, NormalizedOrder } from '../types/analysis'
import { isShopOrInvalidAnchorLabel, mapLiveNickToKnownAnchor } from '../utils/anchor-label'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'

function pickStringFromRecord(
  obj: Record<string, unknown>,
  keys: string[],
): string {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

/** 从订单原始 JSON 提取主播 ID / 名称（优先于直播场次匹配） */
export function extractOrderAnchorFields(pkg: Record<string, unknown>): {
  orderAnchorId: string
  orderAnchorName: string
  orderLiveId: string
} {
  let orderAnchorId = pickStringFromRecord(pkg, [
    'anchorId',
    'anchor_id',
    'hostId',
    'host_id',
    'creatorId',
    'creator_id',
    'liveAnchorId',
    'live_anchor_id',
    'streamerId',
    'streamer_id',
  ])
  let orderAnchorName = pickStringFromRecord(pkg, [
    'anchorName',
    'anchor_name',
    'hostName',
    'host_name',
    'creatorName',
    'creator_name',
    'streamerName',
    'streamer_name',
    'liveAnchorName',
    'live_anchor_name',
    'nickName',
    'nick_name',
  ])

  const liveInfo = pkg.liveInfo ?? pkg.live_info ?? pkg.roomInfo ?? pkg.room_info
  if (liveInfo && typeof liveInfo === 'object') {
    const li = liveInfo as Record<string, unknown>
    if (!orderAnchorId) {
      orderAnchorId = pickStringFromRecord(li, [
        'anchorId',
        'anchor_id',
        'hostId',
        'userId',
        'creatorId',
      ])
    }
    if (!orderAnchorName) {
      orderAnchorName = pickStringFromRecord(li, [
        'anchorName',
        'anchor_name',
        'nickName',
        'nick_name',
        'hostName',
      ])
    }
  }

  const orderLiveId = pickStringFromRecord(pkg, [
    'liveId',
    'live_id',
    'roomId',
    'room_id',
    'liveRoomId',
  ])

  return { orderAnchorId, orderAnchorName, orderLiveId }
}

export function resolveAnchorFromOrderFields(
  order: NormalizedOrder,
  config: AnchorConfig,
): { anchorId: string; anchorName: string } | null {
  const anchorId = order.orderAnchorId?.trim() ?? ''
  const anchorName = order.orderAnchorName?.trim() ?? ''

  if (anchorId) {
    const byId = config.anchors.find((a) => a.enabled && a.id === anchorId)
    if (byId) return { anchorId: byId.id, anchorName: byId.name }
  }

  if (anchorName && !isShopOrInvalidAnchorLabel(anchorName)) {
    const mapped = mapLiveNickToKnownAnchor(anchorName)
    const lookupName = mapped ?? anchorName
    const found = findAnchorByName(config, lookupName)
    if (found?.enabled) return { anchorId: found.id, anchorName: found.name }
    return { anchorId: anchorId || `extra-${lookupName}`, anchorName: lookupName }
  }

  return null
}

export function anchorGroupKey(v: AnalyzedOrderView): string {
  const name = v.anchorName?.trim() || '未归属'
  if (name === '未归属') return '未归属'
  const id = v.anchorId?.trim()
  if (id && id !== name && !id.startsWith('extra-')) return `id:${id}`
  return `name:${name}`
}

/** 筛选属于某主播（或「未归属」）的订单视图 */
export function viewBelongsToAnchor(
  v: AnalyzedOrderView,
  opts: { anchorId?: string; anchorName?: string },
): boolean {
  const anchorId = opts.anchorId?.trim()
  const anchorName = opts.anchorName?.trim()
  if (!anchorId && !anchorName) return true

  const isUnassignedQuery =
    anchorName === '未归属' ||
    anchorId === '未归属' ||
    (!anchorId && anchorName === '未归属')

  if (isUnassignedQuery) {
    const n = v.anchorName?.trim() || '未归属'
    return n === '未归属' || !v.anchorId?.trim()
  }

  const config = getAnchorConfigSync()
  const anchor = anchorId
    ? config.anchors.find((a) => a.id === anchorId)
    : config.anchors.find((a) => a.name === anchorName)
  const name = anchor?.name ?? anchorName
  const id = anchor?.id ?? anchorId

  if (id && v.anchorId === id) return true
  if (name && v.anchorName === name) return true
  if (name && v.anchorName?.includes(name)) return true
  return false
}

export function anchorLeaderboardRowMatches(
  row: { anchorId: string; anchorName: string },
  opts: { anchorId?: string; anchorName?: string },
): boolean {
  return viewBelongsToAnchor(
    { anchorId: row.anchorId, anchorName: row.anchorName } as AnalyzedOrderView,
    opts,
  )
}
