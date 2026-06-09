/**
 * 订单主表来源校验：仅 order_list / order_detail / excel 可作为 isPrimaryOrder
 */
import type { NormalizedOrder, OrderSourceType } from '../types/analysis'
import { pickOfficialDisplayOrderNo } from './order-display-no.service'

function pickString(pkg: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = pkg[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

/** 从订单列表包裹提取主表订单号 */
export function extractPrimaryOrderNoFromPackage(pkg: Record<string, unknown>): string {
  const packageId = pickString(pkg, ['package_id', 'packageId', 'packageNo', 'package_no'])
  const bizOrderId = pickString(pkg, ['order_id', 'orderId', 'order_no', 'orderNo'])
  const official = pickOfficialDisplayOrderNo(pkg, {
    packageId,
    bizOrderId,
  })
  return (official.displayOrderNo || packageId || bizOrderId || '').trim()
}

/**
 * 判断包裹是否来自订单列表主表（排除售后列表混入的伪包裹）
 */
export function isOrderListPrimaryPackage(pkg: Record<string, unknown>): boolean {
  const orderNo = extractPrimaryOrderNoFromPackage(pkg)
  if (!orderNo || !/^P/i.test(orderNo)) return false

  const returnsId = pickString(pkg, ['returns_id', 'returnsId', 'return_id'])
  const orderedAt = pkg.ordered_at ?? pkg.orderedAt ?? pkg.create_time ?? pkg.createTime
  const hasOrderedAt = orderedAt != null && String(orderedAt).trim() !== ''
  const returnTypeName = pickString(pkg, ['return_type_name', 'returnTypeName'])
  const reasonName = pickString(pkg, ['reason_name_zh', 'reasonNameZh', 'reason'])

  // 售后列表字段形态：有 returns_id / 售后原因，但无订单创建时间
  if (returnsId && !hasOrderedAt) return false
  if (returnTypeName && !hasOrderedAt) return false
  if (reasonName && pickString(pkg, ['refund_fee', 'refundFee']) && !hasOrderedAt) return false

  return true
}

export function collectPrimaryOrderNosFromPackages(
  packages: Record<string, unknown>[],
): Set<string> {
  const set = new Set<string>()
  for (const pkg of packages) {
    if (!isOrderListPrimaryPackage(pkg)) continue
    const no = extractPrimaryOrderNoFromPackage(pkg)
    if (no) set.add(no)
  }
  return set
}

export function annotateOrderSource(
  order: NormalizedOrder,
  sourceType: OrderSourceType,
  isPrimaryOrder: boolean,
): NormalizedOrder {
  return { ...order, sourceType, isPrimaryOrder }
}

export function isPrimaryOrderForMetrics(order: NormalizedOrder): boolean {
  if (order.isPrimaryOrder === false) return false
  if (order.sourceType === 'after_sale' || order.sourceType === 'settlement') return false
  return true
}

export function filterPrimaryOrdersForMetrics(orders: NormalizedOrder[]): NormalizedOrder[] {
  return orders.filter(isPrimaryOrderForMetrics)
}

export function warnPrimaryOrderIntegrity(orders: NormalizedOrder[]): string[] {
  const warnings: string[] = []
  for (const o of orders) {
    if (o.sourceType === 'after_sale' && o.isPrimaryOrder) {
      warnings.push(
        `主表完整性异常：${o.displayOrderNo || o.officialOrderNo} sourceType=after_sale 但 isPrimaryOrder=true`,
      )
    }
  }
  return warnings
}
