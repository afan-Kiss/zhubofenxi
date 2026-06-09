/** 从接口单条记录提取业务主键（明天按真实字段调整） */
export function extractOrderId(item: Record<string, unknown>): string | null {
  const id =
    item.orderId ??
    item.order_id ??
    item.packageId ??
    item.package_id ??
    item.id
  return id != null ? String(id) : null
}

export function extractSessionId(item: Record<string, unknown>): string | null {
  const id = item.sessionId ?? item.session_id ?? item.liveId ?? item.live_id ?? item.id
  return id != null ? String(id) : null
}

export function extractOrderTime(item: Record<string, unknown>): string | null {
  const t = item.orderTime ?? item.order_time ?? item.createTime ?? item.create_time
  return t != null ? String(t) : null
}

export function extractBuyerId(item: Record<string, unknown>): string | null {
  const b = item.buyerId ?? item.buyer_id ?? item.userId ?? item.user_id
  return b != null ? String(b) : null
}

export function extractLiveTimes(item: Record<string, unknown>): {
  startTime: string | null
  endTime: string | null
  anchorName: string | null
} {
  const start = item.startTime ?? item.start_time ?? item.liveStartTime
  const end = item.endTime ?? item.end_time ?? item.liveEndTime
  const anchor = item.anchorName ?? item.anchor_name ?? item.hostName ?? item.host_name
  return {
    startTime: start != null ? String(start) : null,
    endTime: end != null ? String(end) : null,
    anchorName: anchor != null ? String(anchor) : null,
  }
}
