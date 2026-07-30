/**
 * 订单列表/详情同步入库前：补齐官方完成时间到稳定字段。
 * 状态文案只晋升官网已有非数字 statusDesc，禁止用状态码编造「交易完成/已签收」。
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
  'packageStatusDesc',
  'sellerStatusDesc',
] as const

const NESTED_CONTAINERS = [
  'package',
  'order',
  'orderInfo',
  'packageInfo',
  'orderDetail',
  'data',
] as const

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

/**
 * 只取官网已有状态文案；数字状态码不编造中文。
 */
function resolveOfficialStatusText(item: Record<string, unknown>): string | null {
  const sources = collectSources(item)
  const text = pickFirst(sources, STATUS_TEXT_KEYS)
  if (text != null) {
    const s = String(text).trim()
    if (s && !/^\d+$/.test(s)) return s
  }
  // status / orderStatus 若本身已是中文文案（非纯数字）也原样返回
  const codeRaw = pickFirst(sources, ['status', 'orderStatus', 'packageStatus', 'tradeStatus'])
  if (codeRaw == null) return null
  const code = String(codeRaw).trim()
  if (code && !/^\d+$/.test(code)) return code
  return null
}

/**
 * 就地补齐 finishTime；statusDesc 仅在缺失时用其它官方文案键补齐，绝不按状态码造词。
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
