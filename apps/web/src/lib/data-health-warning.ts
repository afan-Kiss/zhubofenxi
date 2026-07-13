/** 将后端存储的旧版警告文案转为当前用户可见口径 */
export function formatDataHealthWarning(text: string): string {
  return text
    .replace(/暂未归到主播，请检查主播归属/g, '为自然流散客（未能匹配直播场次），请检查排班与直播号配置')
    .replace(/未归属订单/g, '自然流散客订单')
    .replace(/退款类型未识别，退货退款\/仅退款区分暂不完整/g, '退款未能区分退货退款/仅退款，多因售后明细未同步完整')
    .replace(/有 (\d+) 单退款类型未识别/g, '有 $1 单退款待确认类型')
}

export function resolvePendingRefundTypeCount(report: {
  refundOrderCount?: number
  returnRefundOrderCount?: number
  refundOnlyOrderCount?: number
  unknownRefundTypeOrderCount?: number
}): number {
  const returnCount = report.returnRefundOrderCount ?? 0
  const refundOnlyCount = report.refundOnlyOrderCount ?? 0
  const unknownCount = report.unknownRefundTypeOrderCount ?? 0
  const refundTotal = report.refundOrderCount ?? 0
  return Math.max(unknownCount, refundTotal - returnCount - refundOnlyCount)
}

export function formatRollingRefundBreakdown(report: {
  returnRefundOrderCount?: number
  refundOnlyOrderCount?: number
  unknownRefundTypeOrderCount?: number
  refundOrderCount?: number
  returnRefundTypeIncomplete?: boolean
}): string {
  const returnCount = report.returnRefundOrderCount ?? 0
  const refundOnlyCount = report.refundOnlyOrderCount ?? 0
  const pendingCount = resolvePendingRefundTypeCount(report)

  const fmt = (n: number) => n.toLocaleString('zh-CN')
  if (report.returnRefundTypeIncomplete && returnCount === 0 && refundOnlyCount === 0 && pendingCount === 0 && (report.refundOrderCount ?? 0) > 0) {
    return `退货退款：— 单 ｜仅退款：— 单 ｜待确认：${fmt(report.refundOrderCount ?? 0)} 单`
  }
  return `退货退款：${fmt(returnCount)} 单 ｜仅退款：${fmt(refundOnlyCount)} 单 ｜待确认：${fmt(pendingCount)} 单`
}
