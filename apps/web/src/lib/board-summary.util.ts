/** 经营看板 summary 是否含可展示订单数据 */
export function boardSummaryHasOrderData(
  summary: Record<string, unknown> | null | undefined,
): boolean {
  if (!summary) return false
  const orderCount = Number(summary.orderCount ?? summary.paidOrderCount ?? summary.periodOrderCount ?? 0)
  return orderCount > 0
}
