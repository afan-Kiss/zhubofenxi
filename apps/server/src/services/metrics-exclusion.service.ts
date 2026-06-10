import type { AnalyzedOrderView } from '../types/analysis'
import {
  isLowPriceBrushOrderView,
  LOW_PRICE_BRUSH_THRESHOLD_CENT,
} from './low-price-brush-order.service'

/** 核心指标排除规则：支付基数低于 29 元视为低价刷单，不计入经营总览 / 主播业绩 / 买家排行 */
export { LOW_PRICE_BRUSH_THRESHOLD_CENT }

/** 订单是否应从核心经营指标中排除（仍保留在原始明细 / 导出中） */
export function isExcludedFromCoreMetrics(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): boolean {
  return isLowPriceBrushOrderView(view)
}

export function filterViewsForCoreMetrics<T extends AnalyzedOrderView>(
  views: Array<T & { raw?: Record<string, unknown> }>,
): Array<T & { raw?: Record<string, unknown> }> {
  return views.filter((v) => !isLowPriceBrushOrderView(v))
}

/** 供导出 / 调试：当前生效的排除规则摘要 */
export function describeMetricsExclusionConfig(): {
  lowPriceBrushThresholdYuan: number
} {
  return {
    lowPriceBrushThresholdYuan: LOW_PRICE_BRUSH_THRESHOLD_CENT / 100,
  }
}
