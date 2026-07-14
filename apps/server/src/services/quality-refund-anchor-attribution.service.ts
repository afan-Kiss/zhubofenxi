/**
 * 品退主播归属：继承订单唯一归属（canonical），禁止独立时间规则重算。
 * 保留函数名供旧调用点兼容。
 */
import type { AnalyzedOrderView, AnchorConfig, LiveSession } from '../types/analysis'
import { anchorGroupKey } from './anchor-attribution.util'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import { dedupeOrderCountByOrderNo } from './order-master-match.service'
import { viewCountsAsQualityRefund } from './quality-refund-resolution.service'
import { resolveQualityRefundInfo } from './quality-refund-resolution.service'
import { getAnchorConfigSync } from './anchor.service'
import {
  resolveCanonicalOrderAttribution,
  parseViewOrderCreateTimeMs,
  canonicalAttributionLabel,
  type CanonicalAttributionType,
} from './canonical-order-attribution.service'

export type QualityRefundAnchorAttributionType =
  | 'live_session_anchor'
  | 'live_session_time_rule'
  | 'unassigned'
  | 'manual_override'
  | 'confirmed_schedule'
  | 'conflict'
  | 'live_session'

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
  /** 与订单唯一归属相同 */
  paymentAnchorName: string
  attributionExplain?: string
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

/** @deprecated 使用 parseViewOrderCreateTimeMs */
export function resolveOrderPlaceTime(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): { date: Date | null; text: string } {
  const { ms, text } = parseViewOrderCreateTimeMs(view)
  return { date: ms != null ? new Date(ms) : null, text }
}

function mapCanonicalType(t: CanonicalAttributionType): QualityRefundAnchorAttributionType {
  switch (t) {
    case 'manual_override':
      return 'manual_override'
    case 'live_session':
      return 'live_session'
    case 'confirmed_schedule':
    case 'generated_default':
    case 'virtual_template':
      return 'confirmed_schedule'
    case 'conflict':
      return 'conflict'
    default:
      return 'unassigned'
  }
}

/**
 * 品退归属 = 订单唯一归属。品退接口只确认是否品退，不重算主播。
 */
export async function resolveQualityRefundAnchorByOrderTime(params: {
  view: AnalyzedOrderView & { raw?: Record<string, unknown> }
  liveSessions?: LiveSession[]
  config?: AnchorConfig
  afterSaleRecords?: Record<string, unknown>[]
}): Promise<QualityRefundAnchorAttribution | null> {
  const { view } = params
  if (!viewCountsAsQualityRefund(view)) return null

  const qualityInfo = resolveQualityRefundInfo({
    view,
    afterSaleRecords: params.afterSaleRecords,
    verifySource: 'after_sale_workbench',
  })
  const canonical = await resolveCanonicalOrderAttribution(view)
  const create = parseViewOrderCreateTimeMs(view)
  const orderNo = resolveMetricOrderNo(view)
  const anchorKey =
    canonical.canonicalAnchorName === '未归属'
      ? '未归属'
      : anchorGroupKey({
          anchorId: canonical.canonicalAnchorId,
          anchorName: canonical.canonicalAnchorName,
        } as AnalyzedOrderView)

  return {
    orderNo,
    view,
    orderTime: create.ms != null ? new Date(create.ms) : null,
    orderTimeText: create.text,
    anchorId: canonical.canonicalAnchorId,
    anchorName: canonical.canonicalAnchorName,
    anchorKey,
    matchedLiveSessionId: canonical.matchedLiveSessionId,
    matchedLiveStartTime: null,
    matchedLiveEndTime: null,
    attributionType: mapCanonicalType(canonical.attributionType),
    qualitySource: qualityInfo.qualityMainSource,
    qualitySourceLabel: qualityInfo.verifyDisplayLabel,
    qualityReasonText: qualityInfo.qualityReasonText,
    unassignedReason: canonical.conflictReason ?? (canonical.attributionType === 'unassigned' ? canonical.attributionExplain : null),
    paymentAnchorName: canonical.canonicalAnchorName,
    attributionExplain: `${canonicalAttributionLabel(canonical.attributionType)}｜${canonical.attributionExplain}`,
  }
}

export async function aggregateQualityRefundByAnchor(params: {
  views: AnalyzedOrderView[]
  liveSessions?: LiveSession[]
  config?: AnchorConfig
}): Promise<AggregateQualityRefundAnchorResult> {
  void params.liveSessions
  void params.config
  const byAnchorKey = new Map<string, AnchorQualityRefundBucket>()
  const attributions: QualityRefundAnchorAttribution[] = []
  const unassigned: QualityRefundAnchorAttribution[] = []
  const seenOrderNos = new Set<string>()

  for (const view of params.views) {
    const attr = await resolveQualityRefundAnchorByOrderTime({ view })
    if (!attr) continue
    if (!attr.orderNo || seenOrderNos.has(attr.orderNo)) continue
    seenOrderNos.add(attr.orderNo)
    attributions.push(attr)
    if (attr.anchorName === '未归属' || attr.attributionType === 'conflict') {
      unassigned.push(attr)
      continue
    }
    const existing = byAnchorKey.get(attr.anchorKey)
    if (existing) {
      existing.orderNos.push(attr.orderNo)
      existing.count = existing.orderNos.length
    } else {
      byAnchorKey.set(attr.anchorKey, {
        anchorId: attr.anchorId,
        anchorName: attr.anchorName,
        anchorKey: attr.anchorKey,
        orderNos: [attr.orderNo],
        count: 1,
      })
    }
  }

  return {
    byAnchorKey,
    attributions,
    totalQualityRefundCount: dedupeOrderCountByOrderNo(attributions.map((a) => a.orderNo)),
    unassigned,
  }
}

export function listQualityRefundAttributionsForAnchor(params: {
  attributions: QualityRefundAnchorAttribution[]
  anchorId?: string
  anchorName?: string
}): Array<{
  orderNo: string
  orderTimeText: string
  anchorName: string
  attributionType: QualityRefundAnchorAttributionType
  qualitySourceLabel: string
  qualityReasonText: string
}> {
  const id = params.anchorId?.trim()
  const name = params.anchorName?.trim()
  return params.attributions
    .filter((a) => {
      if (name === '未归属') return a.anchorName === '未归属'
      if (name) return a.anchorName === name
      if (id) return a.anchorId === id
      return true
    })
    .map((a) => ({
      orderNo: a.orderNo,
      orderTimeText: a.orderTimeText,
      anchorName: a.anchorName,
      attributionType: a.attributionType,
      qualitySourceLabel: a.qualitySourceLabel,
      qualityReasonText: a.qualityReasonText,
    }))
}

export function qualityRefundPerAnchorSummary(
  agg: AggregateQualityRefundAnchorResult,
): Array<{ anchorName: string; anchorId: string; qualityReturnCount: number }> {
  return [...agg.byAnchorKey.values()]
    .map((b) => ({
      anchorName: b.anchorName,
      anchorId: b.anchorId,
      qualityReturnCount: b.count,
    }))
    .sort((a, b) => b.qualityReturnCount - a.qualityReturnCount)
}

void getAnchorConfigSync

/** 同步诊断页：品退按订单唯一归属聚合（兼容旧函数名） */
export async function buildAnchorQualityRefundAttributionDiagnostic(params: {
  views: AnalyzedOrderView[]
  liveSessions?: LiveSession[]
  boardQualityReturnCount?: number
}): Promise<{
  boardQualityReturnCount: number
  attributedQualityReturnCount: number
  unassignedCount: number
  byAnchor: Array<{ anchorName: string; qualityReturnCount: number }>
  note: string
}> {
  const agg = await aggregateQualityRefundByAnchor({
    views: params.views,
    liveSessions: params.liveSessions,
  })
  return {
    boardQualityReturnCount: params.boardQualityReturnCount ?? agg.totalQualityRefundCount,
    attributedQualityReturnCount: agg.totalQualityRefundCount - agg.unassigned.length,
    unassignedCount: agg.unassigned.length,
    byAnchor: qualityRefundPerAnchorSummary(agg).map((r) => ({
      anchorName: r.anchorName,
      qualityReturnCount: r.qualityReturnCount,
    })),
    note: '品退主播继承订单唯一归属（canonical），不再按品退时间重算',
  }
}
