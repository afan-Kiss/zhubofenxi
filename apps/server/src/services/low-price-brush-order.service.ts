import type { AnalyzedOrderView } from '../types/analysis'
import { attachOrderRawToView } from './order-shop-ownership.util'

/**
 * 经营分析最低实付门槛（分）：原始订单仍完整保存；
 * paidAmountCent < 1800（¥18）不参与经营/主播/上月对比/AI 分析。
 * ¥18 本身保留（>= 1800 计入）。
 */
export const MIN_ANALYSIS_ORDER_AMOUNT_CENT = 1800

/** @deprecated 兼容旧名；与 MIN_ANALYSIS_ORDER_AMOUNT_CENT 相同 */
export const LOW_PRICE_BRUSH_THRESHOLD_CENT = MIN_ANALYSIS_ORDER_AMOUNT_CENT

/** 买家榜/客户榜统一说明文案 */
export const LOW_PRICE_BRUSH_BUYER_RANKING_NOTE =
  '支付基数低于 ¥18.00 的刷单/测试类订单已自动排除。'

const PRODUCT_UNIT_PRICE_KEYS = [
  'productPrice',
  'salePrice',
  'itemPrice',
  'skuPrice',
  'price',
  'skuSoldPrice',
]

const QTY_KEYS = ['skuQuantity', 'quantity', 'qty', 'count', 'buyCount', 'skuCount', 'itemCount']

function readQtyFromRaw(raw: Record<string, unknown>): number | null {
  for (const k of QTY_KEYS) {
    const n = Number(raw[k])
    if (Number.isFinite(n) && n > 0) return n
  }
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    let total = 0
    for (const row of skus) {
      if (!row || typeof row !== 'object') continue
      const sku = row as Record<string, unknown>
      let qty = 0
      for (const k of QTY_KEYS) {
        const n = Number(sku[k])
        if (Number.isFinite(n) && n > 0) {
          qty = n
          break
        }
      }
      total += qty > 0 ? qty : 1
    }
    if (total > 0) return total
  }
  return null
}

/** 主播业绩 / 买家排行：按订单支付基数（商家应收优先）判断低价刷单 */
export function resolvePaymentBaseCentForBrushCheck(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): number {
  if (view.paymentBaseCent > 0) return view.paymentBaseCent
  if (view.actualSellerReceiveAmountCent > 0) return view.actualSellerReceiveAmountCent
  if ((view.statPaidAmountCent ?? 0) > 0) return view.statPaidAmountCent ?? 0
  if (view.actualPaidCent > 0) return view.actualPaidCent
  if (view.receivableAmountCent > 0) return view.receivableAmountCent
  if (view.includedInGmv) return view.paymentBaseCent
  return 0
}

/** @deprecated 保留供导出调试列；主播过滤以支付基数为准 */
export function resolveUnitPriceCentForBrushCheck(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): number {
  return resolvePaymentBaseCentForBrushCheck(view)
}

export function isLowPriceBrushOrderView(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): boolean {
  const payCent = resolvePaymentBaseCentForBrushCheck(view)
  return payCent > 0 && payCent < LOW_PRICE_BRUSH_THRESHOLD_CENT
}

/** 聚合前将 raw 挂到 view，供单价低价判断使用 */
export function attachRawByMatchToViews<T extends AnalyzedOrderView>(
  views: T[],
  rawByMatch: Map<string, Record<string, unknown>>,
): Array<T & { raw?: Record<string, unknown> }> {
  return views.map((v) => {
    const raw = rawByMatch.get(v.matchOrderId || v.orderId)
    if (!raw) return v
    return attachOrderRawToView(v, raw)
  })
}

export function resolveLowPriceBrushDebugFields(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): {
  unitPriceCentForBrushCheck: number
  isLowPriceBrushOrder: boolean
  lowPriceBrushReason: string | null
} {
  const payCent = resolvePaymentBaseCentForBrushCheck(view)
  const isLowPriceBrushOrder = payCent > 0 && payCent < LOW_PRICE_BRUSH_THRESHOLD_CENT
  if (!isLowPriceBrushOrder) {
    return { unitPriceCentForBrushCheck: payCent, isLowPriceBrushOrder: false, lowPriceBrushReason: null }
  }
  return {
    unitPriceCentForBrushCheck: payCent,
    isLowPriceBrushOrder: true,
    lowPriceBrushReason: 'payment_base_below_threshold',
  }
}

export function filterViewsForAnchorPerformance<T extends AnalyzedOrderView>(
  views: Array<T & { raw?: Record<string, unknown> }>,
): Array<T & { raw?: Record<string, unknown> }> {
  return views.filter((v) => !isLowPriceBrushOrderView(v))
}

/** 买家排行 / 买家画像：支付基数低于 ¥18 的订单不参与聚合 */
export function filterViewsForBuyerRanking<T extends AnalyzedOrderView>(
  views: Array<T & { raw?: Record<string, unknown> }>,
): Array<T & { raw?: Record<string, unknown> }> {
  return views.filter((v) => !isLowPriceBrushOrderView(v))
}
