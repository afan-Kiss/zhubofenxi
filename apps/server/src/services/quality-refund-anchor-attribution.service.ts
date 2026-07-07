/**
 * 品退订单主播归属：按订单下单时间匹配直播场次，不使用 paymentTime / 全局订单归属。
 */
import type { AnalyzedOrderView, AnchorConfig, LiveSession } from '../types/analysis'
import { isShopOrInvalidAnchorLabel, mapLiveNickToKnownAnchor } from '../utils/anchor-label'
import { parseDateTime } from '../utils/time'
import { anchorGroupKey } from './anchor-attribution.util'
import { findAnchorByName, matchTimeRule } from './anchor-rules.service'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import { dedupeOrderCountByOrderNo } from './order-master-match.service'
import { findBestLiveSession } from './live-session.service'
import { viewCountsAsQualityRefund } from './quality-refund-resolution.service'
import { resolveQualityRefundInfo } from './quality-refund-resolution.service'
import { resolveManualAnchorOverrideForView } from './order-anchor-manual-override.service'
import { getAnchorConfigSync } from './anchor.service'

const RAW_ORDER_PLACE_TIME_KEYS = [
  'create_time',
  'createTime',
  'order_time',
  'orderTime',
  'order_create_time',
  'orderCreateTime',
  'placed_at',
  'placedAt',
] as const

export type QualityRefundAnchorAttributionType =
  | 'live_session_anchor'
  | 'live_session_time_rule'
  | 'unassigned'
  | 'manual_override'

export interface QualityRefundAnchorAttribution {
  orderNo: string
  view: AnalyzedOrderView
  orderTime: Date | null
  orderTimeText: string
  anchorId: string
  anchorName: string
  anchorKey: string
  matchedLiveSessionId: string | null
  matchedLiveStartTime: string | null
  matchedLiveEndTime: string | null
  attributionType: QualityRefundAnchorAttributionType
  qualitySource: 'official_bad_case' | 'after_sale' | 'none'
  qualitySourceLabel: string
  qualityReasonText: string
  unassignedReason: string | null
  paymentAnchorName: string
}

export interface AnchorQualityRefundBucket {
  anchorId: string
  anchorName: string
  anchorKey: string
  orderNos: string[]
  count: number
}

export interface AggregateQualityRefundAnchorResult {
  byAnchorKey: Map<string, AnchorQualityRefundBucket>
  attributions: QualityRefundAnchorAttribution[]
  totalQualityRefundCount: number
  unassigned: QualityRefundAnchorAttribution[]
}

let liveSessionsCache: LiveSession[] = []

export function setLiveSessionsForQualityRefundAttribution(sessions: LiveSession[]): void {
  liveSessionsCache = sessions
}

export function getLiveSessionsForQualityRefundAttribution(): LiveSession[] {
  return liveSessionsCache
}

function pickStringFromRaw(raw: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = raw[k]
    if (v == null || v === '') continue
    const s = String(v).trim()
    if (s) return s
  }
  return ''
}

/** 解析订单下单时间（禁止用 paymentTime） */
export function resolveOrderPlaceTime(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): { date: Date | null; text: string } {
  const textFromView = view.orderTimeText?.trim() ?? ''
  if (textFromView && textFromView !== '—') {
    const parsed = parseDateTime(textFromView)
    if (parsed.ok) return { date: parsed.date, text: textFromView }
  }
  const raw = view.raw
  if (raw && typeof raw === 'object') {
    const fromRaw = pickStringFromRaw(raw as Record<string, unknown>, RAW_ORDER_PLACE_TIME_KEYS)
    if (fromRaw) {
      const parsed = parseDateTime(fromRaw)
      if (parsed.ok) return { date: parsed.date, text: fromRaw }
    }
  }
  return { date: null, text: textFromView || '—' }
}

function resolveAnchorFromLiveSession(
  session: LiveSession,
  config: AnchorConfig,
): { anchorId: string; anchorName: string; attributionType: QualityRefundAnchorAttributionType } {
  if (session.anchorId) {
    const anchor = config.anchors.find((a) => a.enabled && a.id === session.anchorId)
    if (anchor) {
      return {
        anchorId: anchor.id,
        anchorName: anchor.name,
        attributionType: 'live_session_anchor',
      }
    }
  }
  if (session.anchorName) {
    const trimmed = session.anchorName.trim()
    if (!isShopOrInvalidAnchorLabel(trimmed)) {
      const mapped = mapLiveNickToKnownAnchor(trimmed)
      const found = findAnchorByName(config, mapped ?? trimmed)
      if (found?.enabled) {
        return {
          anchorId: found.id,
          anchorName: found.name,
          attributionType: 'live_session_anchor',
        }
      }
    }
  }
  const inferred = matchTimeRule(session.startTime, config)
  if (inferred) {
    return {
      anchorId: inferred.anchor.id,
      anchorName: inferred.anchor.name,
      attributionType: 'live_session_time_rule',
    }
  }
  return { anchorId: '', anchorName: '未归属', attributionType: 'unassigned' }
}

export function resolveQualityRefundAnchorByOrderTime(params: {
  view: AnalyzedOrderView & { raw?: Record<string, unknown> }
  liveSessions: LiveSession[]
  config?: AnchorConfig
  afterSaleRecords?: Record<string, unknown>[]
}): QualityRefundAnchorAttribution | null {
  const { view, liveSessions } = params
  if (!viewCountsAsQualityRefund(view)) return null

  const config = params.config ?? getAnchorConfigSync()
  const orderNo = resolveMetricOrderNo(view)
  const { date: orderTime, text: orderTimeText } = resolveOrderPlaceTime(view)
  const qualityInfo = resolveQualityRefundInfo({
    view,
    afterSaleRecords: params.afterSaleRecords,
    verifySource: 'after_sale_workbench',
  })
  const paymentAnchorName = view.anchorName?.trim() || '未归属'

  const manual = resolveManualAnchorOverrideForView(view)
  if (manual) {
    const anchorKey =
      manual.anchorName === '未归属'
        ? '未归属'
        : anchorGroupKey({
            anchorId: manual.anchorId,
            anchorName: manual.anchorName,
          } as AnalyzedOrderView)
    return {
      orderNo,
      view,
      orderTime,
      orderTimeText,
      anchorId: manual.anchorId,
      anchorName: manual.anchorName,
      anchorKey,
      matchedLiveSessionId: null,
      matchedLiveStartTime: null,
      matchedLiveEndTime: null,
      attributionType: 'manual_override',
      qualitySource: qualityInfo.qualityMainSource,
      qualitySourceLabel: qualityInfo.verifyDisplayLabel,
      qualityReasonText: qualityInfo.qualityReasonText,
      unassignedReason: null,
      paymentAnchorName,
    }
  }

  let anchorId = ''
  let anchorName = '未归属'
  let attributionType: QualityRefundAnchorAttributionType = 'unassigned'
  let matchedLiveSessionId: string | null = null
  let matchedLiveStartTime: string | null = null
  let matchedLiveEndTime: string | null = null
  let unassignedReason: string | null = null

  if (!orderTime) {
    unassignedReason = '无法解析订单下单时间'
  } else {
    const session = findBestLiveSession(orderTime, liveSessions)
    if (!session) {
      unassignedReason = '下单时间未命中直播场次'
    } else {
      matchedLiveSessionId = session.id
      matchedLiveStartTime = session.startTimeText
      matchedLiveEndTime = session.endTimeText
      const fromSession = resolveAnchorFromLiveSession(session, config)
      anchorId = fromSession.anchorId
      anchorName = fromSession.anchorName
      attributionType = fromSession.attributionType
      if (anchorName === '未归属') {
        unassignedReason = '命中直播场次但场次未配置主播'
      }
    }
  }

  const anchorKey =
    anchorName === '未归属'
      ? '未归属'
      : anchorGroupKey({ anchorId, anchorName } as AnalyzedOrderView)

  return {
    orderNo,
    view,
    orderTime,
    orderTimeText,
    anchorId,
    anchorName,
    anchorKey,
    matchedLiveSessionId,
    matchedLiveStartTime,
    matchedLiveEndTime,
    attributionType,
    qualitySource: qualityInfo.qualityMainSource,
    qualitySourceLabel: qualityInfo.verifyDisplayLabel,
    qualityReasonText: qualityInfo.qualityReasonText,
    unassignedReason,
    paymentAnchorName,
  }
}

export function aggregateQualityRefundByAnchor(params: {
  views: AnalyzedOrderView[]
  liveSessions?: LiveSession[]
  config?: AnchorConfig
}): AggregateQualityRefundAnchorResult {
  const liveSessions = params.liveSessions ?? liveSessionsCache
  const config = params.config ?? getAnchorConfigSync()
  const byAnchorKey = new Map<string, AnchorQualityRefundBucket>()
  const attributions: QualityRefundAnchorAttribution[] = []
  const unassigned: QualityRefundAnchorAttribution[] = []
  const seenOrderNos = new Set<string>()

  for (const view of params.views) {
    const attr = resolveQualityRefundAnchorByOrderTime({ view, liveSessions, config })
    if (!attr) continue
    if (!attr.orderNo || seenOrderNos.has(attr.orderNo)) continue
    seenOrderNos.add(attr.orderNo)
    attributions.push(attr)

    const bucket =
      byAnchorKey.get(attr.anchorKey) ??
      ({
        anchorId: attr.anchorId,
        anchorName: attr.anchorName,
        anchorKey: attr.anchorKey,
        orderNos: [],
        count: 0,
      } satisfies AnchorQualityRefundBucket)
    bucket.orderNos.push(attr.orderNo)
    bucket.count += 1
    byAnchorKey.set(attr.anchorKey, bucket)

    if (attr.anchorName === '未归属' || attr.unassignedReason) {
      unassigned.push(attr)
    }
  }

  return {
    byAnchorKey,
    attributions,
    totalQualityRefundCount: dedupeOrderCountByOrderNo(attributions.map((a) => a.orderNo)),
    unassigned,
  }
}

export interface AnchorQualityRefundAttributionDiagnostic {
  perAnchor: Array<{ anchorName: string; anchorId: string; qualityReturnCount: number }>
  unassignedOrders: Array<{
    orderNo: string
    orderTimeText: string
    paymentAnchorName: string
    reason: string
    qualitySourceLabel: string
  }>
  anchorCardsTotal: number
  boardQualityReturnCount: number
  matched: boolean
  note: string
}

export function buildAnchorQualityRefundAttributionDiagnostic(params: {
  views: AnalyzedOrderView[]
  liveSessions: LiveSession[]
  boardQualityReturnCount: number
}): AnchorQualityRefundAttributionDiagnostic {
  const agg = aggregateQualityRefundByAnchor({
    views: params.views,
    liveSessions: params.liveSessions,
  })
  const perAnchor = [...agg.byAnchorKey.values()]
    .map((b) => ({
      anchorName: b.anchorName,
      anchorId: b.anchorId,
      qualityReturnCount: b.count,
    }))
    .sort((a, b) => b.qualityReturnCount - a.qualityReturnCount)

  const anchorCardsTotal = agg.totalQualityRefundCount
  const matched = anchorCardsTotal === params.boardQualityReturnCount
  let note = `主播卡片品退合计 ${anchorCardsTotal} 单，经营总览品退 ${params.boardQualityReturnCount} 单。`
  if (!matched) {
    note += ' 合计不一致，请核对低价刷单排除或统计范围。'
  }

  return {
    perAnchor,
    unassignedOrders: agg.unassigned.map((a) => ({
      orderNo: a.orderNo,
      orderTimeText: a.orderTimeText,
      paymentAnchorName: a.paymentAnchorName,
      reason: a.unassignedReason ?? '未归属',
      qualitySourceLabel: a.qualitySourceLabel,
    })),
    anchorCardsTotal,
    boardQualityReturnCount: params.boardQualityReturnCount,
    matched,
    note,
  }
}
