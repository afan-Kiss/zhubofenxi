import type { AnalyzedOrderView } from '../types/analysis'
import { resolveDisplayOrderNoForView } from './order-display-no.service'

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
