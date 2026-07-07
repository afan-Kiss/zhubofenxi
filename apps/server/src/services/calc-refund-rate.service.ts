import type { AnalyzedOrderView } from '../types/analysis'
import { resolveDisplayOrderNoForView } from './order-display-no.service'
import { resolveViewRefundAmountCent } from './order-refund-metrics.service'
import { isEffectiveSignedView } from './strict-after-sale-metrics.service'

export interface OrderRateResult {
  numeratorOrderCount: number
  paidOrderCount: number
  rate: number | null
  rateText: string
  refundOrderNosNotInPaid: string[]
  duplicateNumeratorOrderNos: string[]
}

export interface RefundRateResult extends OrderRateResult {
  refundOrderCount: number
  refundRate: number | null
  refundRateText: string
}

/** 指标用 P 开头订单号（去重键） */
export function resolveMetricOrderNo(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
): string {
  const no = resolveDisplayOrderNoForView(v).trim()
  if (!no || no === '—') return ''
  return no
}

/** 按 P 单号去重，保留首条视图（品退 Drawer 与卡片分子对齐） */
export function dedupeViewsByMetricOrderNo(views: AnalyzedOrderView[]): AnalyzedOrderView[] {
  const seen = new Set<string>()
  const out: AnalyzedOrderView[] = []
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) {
      out.push(v)
      continue
    }
    if (seen.has(no)) continue
    seen.add(no)
    out.push(v)
  }
  return out
}

function resolveSignedAmountCent(v: AnalyzedOrderView): number {
  return v.actualSignAmountCent ?? v.actualSignedAmountCent ?? 0
}

/** 同 P 单内选择更适合 GMV / 签收等核心指标的视图 */
function compareCoreMetricViewPriority(a: AnalyzedOrderView, b: AnalyzedOrderView): number {
  const aGmv = a.includedInGmv === true ? 1 : 0
  const bGmv = b.includedInGmv === true ? 1 : 0
  if (aGmv !== bGmv) return aGmv - bGmv

  const payDiff = (a.paymentBaseCent ?? 0) - (b.paymentBaseCent ?? 0)
  if (payDiff !== 0) return payDiff

  const aSigned = isEffectiveSignedView(a) ? 1 : 0
  const bSigned = isEffectiveSignedView(b) ? 1 : 0
  if (aSigned !== bSigned) return aSigned - bSigned

  return resolveSignedAmountCent(a) - resolveSignedAmountCent(b)
}

/** 核心指标按 P 单去重，保留 payment/签收信息更完整的视图 */
export function dedupeCoreMetricViewsByOrderNoBestValue(
  views: AnalyzedOrderView[],
): AnalyzedOrderView[] {
  const bestByOrderNo = new Map<string, AnalyzedOrderView>()
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    const prev = bestByOrderNo.get(no)
    if (!prev || compareCoreMetricViewPriority(v, prev) > 0) {
      bestByOrderNo.set(no, v)
    }
  }
  const seen = new Set<string>()
  const out: AnalyzedOrderView[] = []
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) {
      out.push(v)
      continue
    }
    if (seen.has(no)) continue
    seen.add(no)
    out.push(bestByOrderNo.get(no)!)
  }
  return out
}

/** 退款类抽屉按 P 单去重，保留 resolveViewRefundAmountCent 最大的视图 */
export function dedupeRefundMetricViewsByOrderNoMaxRefund(
  views: AnalyzedOrderView[],
): AnalyzedOrderView[] {
  const bestByOrderNo = new Map<string, AnalyzedOrderView>()
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    const prev = bestByOrderNo.get(no)
    if (!prev || resolveViewRefundAmountCent(v) > resolveViewRefundAmountCent(prev)) {
      bestByOrderNo.set(no, v)
    }
  }
  const seen = new Set<string>()
  const out: AnalyzedOrderView[] = []
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) {
      out.push(v)
      continue
    }
    if (seen.has(no)) continue
    seen.add(no)
    out.push(bestByOrderNo.get(no)!)
  }
  return out
}

/** 运费补偿抽屉：按 P 单保留 freightRefundAmountCent 最大的 view */
export function dedupeFreightRefundViewsByOrderNoMaxFreight(
  views: AnalyzedOrderView[],
): AnalyzedOrderView[] {
  const bestByOrderNo = new Map<string, AnalyzedOrderView>()
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    const prev = bestByOrderNo.get(no)
    const cent = v.freightRefundAmountCent ?? 0
    const prevCent = prev?.freightRefundAmountCent ?? 0
    if (!prev || cent > prevCent) {
      bestByOrderNo.set(no, v)
    }
  }
  const seen = new Set<string>()
  const out: AnalyzedOrderView[] = []
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) {
      out.push(v)
      continue
    }
    if (seen.has(no)) continue
    seen.add(no)
    out.push(bestByOrderNo.get(no)!)
  }
  return out
}

function toOrderNoSet(nos: Iterable<string>): Set<string> {
  const set = new Set<string>()
  for (const raw of nos) {
    const t = String(raw).trim()
    if (t && t !== '—') set.add(t)
  }
  return set
}

/**
 * 比例 = 分子订单数 ÷ 本期支付订单数（均按 P 订单号去重）
 * 分子仅保留属于 paid 集合的订单，避免跨期/未支付污染
 */
export function calcOrderRate(params: {
  paidOrderNos: Iterable<string>
  numeratorOrderNos: Iterable<string>
}): OrderRateResult {
  const paidSet = toOrderNoSet(params.paidOrderNos)
  const seenNum = new Set<string>()
  const numeratorSet = new Set<string>()
  const notInPaid: string[] = []
  const duplicates: string[] = []

  for (const raw of params.numeratorOrderNos) {
    const no = String(raw).trim()
    if (!no || no === '—') continue
    if (seenNum.has(no)) duplicates.push(no)
    seenNum.add(no)
    if (paidSet.has(no)) numeratorSet.add(no)
    else notInPaid.push(no)
  }

  const paidOrderCount = paidSet.size
  const numeratorOrderCount = numeratorSet.size
  const rate = paidOrderCount === 0 ? null : numeratorOrderCount / paidOrderCount

  return {
    numeratorOrderCount,
    paidOrderCount,
    rate,
    rateText: rate == null ? '--' : `${(rate * 100).toFixed(2)}%`,
    refundOrderNosNotInPaid: [...new Set(notInPaid)],
    duplicateNumeratorOrderNos: [...new Set(duplicates)],
  }
}

export function calcRefundRate(params: {
  paidOrderNos: Iterable<string>
  refundOrderNos: Iterable<string>
}): RefundRateResult {
  const base = calcOrderRate({
    paidOrderNos: params.paidOrderNos,
    numeratorOrderNos: params.refundOrderNos,
  })
  return {
    ...base,
    refundOrderCount: base.numeratorOrderCount,
    refundRate: base.rate,
    refundRateText: base.rateText,
  }
}

export interface RefundRateWarnContext {
  scope: string
  anchorId?: string
  anchorName?: string
}

export function warnIfRefundOrderCountExceedsPaid(
  result: RefundRateResult,
  ctx: RefundRateWarnContext,
): void {
  if (result.refundOrderCount <= result.paidOrderCount) return
  console.warn(
    `[refund-rate] 退款订单数大于支付订单数，请检查重复售后或跨期数据 scope=${ctx.scope}` +
      ` anchorId=${ctx.anchorId ?? ''} anchorName=${ctx.anchorName ?? ''}` +
      ` paidOrderCount=${result.paidOrderCount} refundOrderCount=${result.refundOrderCount}` +
      ` duplicateRefundOrderNos=${result.duplicateNumeratorOrderNos.join(',')}` +
      ` refundOrderNosNotInPaid=${result.refundOrderNosNotInPaid.join(',')}`,
  )
}
