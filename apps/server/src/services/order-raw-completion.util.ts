/**
 * 订单列表/详情同步入库前：补齐官方完成时间与状态文案到稳定字段。
 * 不改口径，只做字段晋升，便于已签收下钻展示「交易完成」与完成时间。
 */

const FINISH_TIME_ALIAS_KEYS = [
  'finishTime',
  'finishedAt',
  'orderFinishTime',
  'finish_time',
  'completedAt',
  'completed_time',
  'completeTime',
  'orderCompleteTime',
  'signedAt',
  'signTime',
  'receiveTime',
  'confirmReceiveTime',
  'confirm_receive_time',
  'confirmReceiveAt',
] as const

const STATUS_TEXT_KEYS = [
  'statusDesc',
  'status_desc',
  'orderStatusDesc',
  'order_status_desc',
  'statusName',
  'status_name',
  'tradeStatusDesc',
  'trade_status_desc',
] as const

const NESTED_CONTAINERS = [
  'package',
  'order',
  'orderInfo',
  'packageInfo',
  'orderDetail',
  'data',
] as const

/** 千帆包裹常见状态码 → 官方文案（仅在无 statusDesc 时回填） */
const PACKAGE_STATUS_CODE_LABEL: Record<string, string> = {
  '6': '已发货',
  '7': '交易完成',
  '71': '交易完成',
  '8': '已关闭',
  '9': '已取消',
}

function isNonEmpty(value: unknown): boolean {
  return value != null && String(value).trim() !== ''
}

function collectSources(item: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [item]
  for (const key of NESTED_CONTAINERS) {
    const nested = item[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      out.push(nested as Record<string, unknown>)
    }
  }
  return out
}

function pickFirst(
  sources: Record<string, unknown>[],
  keys: readonly string[],
): unknown {
  for (const source of sources) {
    for (const key of keys) {
      if (isNonEmpty(source[key])) return source[key]
    }
  }
  return null
}

function resolveOfficialStatusText(item: Record<string, unknown>): string | null {
  const sources = collectSources(item)
  const text = pickFirst(sources, STATUS_TEXT_KEYS)
  if (text != null) {
    const s = String(text).trim()
    if (s && !/^\d+$/.test(s)) return s
  }
  const codeRaw = pickFirst(sources, ['status', 'orderStatus', 'packageStatus', 'tradeStatus'])
  if (codeRaw == null) return null
  const code = String(codeRaw).trim()
  if (PACKAGE_STATUS_CODE_LABEL[code]) return PACKAGE_STATUS_CODE_LABEL[code]
  if (code && !/^\d+$/.test(code)) return code
  return null
}

/**
 * 就地补齐 finishTime / statusDesc，供后续 normalize 与下钻解析复用。
 * 返回是否有字段被写入（便于测试）。
 */
export function ensureOrderRawCompletionFields(item: Record<string, unknown>): {
  finishTimePromoted: boolean
  statusDescPromoted: boolean
} {
  const sources = collectSources(item)
  let finishTimePromoted = false
  let statusDescPromoted = false

  if (!isNonEmpty(item.finishTime)) {
    const finish = pickFirst(sources, FINISH_TIME_ALIAS_KEYS)
    if (finish != null) {
      item.finishTime = finish
      finishTimePromoted = true
    }
  }

  const officialStatus = resolveOfficialStatusText(item)
  const currentDesc = item.statusDesc ?? item.status_desc
  const currentIsNumeric =
    currentDesc != null && /^\d+$/.test(String(currentDesc).trim())
  if (officialStatus && (!isNonEmpty(currentDesc) || currentIsNumeric)) {
    item.statusDesc = officialStatus
    statusDescPromoted = true
  }

  return { finishTimePromoted, statusDescPromoted }
}

export function resolveOfficialOrderStatusText(
  item: Record<string, unknown> | undefined,
): string {
  if (!item) return ''
  return resolveOfficialStatusText(item) ?? ''
}
