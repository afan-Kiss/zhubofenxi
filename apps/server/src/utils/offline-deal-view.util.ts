/**
 * 线下成交视图识别（纯函数，无副作用）。
 * 不得引用 prisma / service / 环境变量，避免循环依赖。
 */
import type { AnalyzedOrderView } from '../types/analysis'

export function isOfflineDealView(
  view: AnalyzedOrderView & {
    raw?: Record<string, unknown>
    scheduleAttributionSource?: string | null
  },
): boolean {
  if (view.sourceType === 'offline_deal' || view.dealSource === 'offline') return true
  if (view.offlineDealKey) return true
  if (view.scheduleAttributionSource === 'offline_manual') return true
  const raw = view.raw
  if (raw && (raw.dealSource === 'offline' || raw.sourceType === 'offline_deal')) return true
  const orderNo = String(
    view.displayOrderNo || view.officialOrderNo || view.packageId || view.orderId || '',
  ).trim()
  if (/^OFF-/i.test(orderNo)) return true
  if (/^offline:/i.test(orderNo)) return true
  return false
}
