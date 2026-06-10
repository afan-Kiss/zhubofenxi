export function formatMoney(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatIntegerMoney(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}`
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '--'
  const m = Math.round(minutes)
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h > 0 && min > 0) return `${h}小时${min}分`
  if (h > 0) return `${h}小时`
  return `${min}分钟`
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '--'
  return `${Math.round(ratio)}%`
}

export function formatDensity(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '--'
  return `${Math.round(minutes)}分钟/单`
}

export function formatHourly(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}/小时`
}

export function formatOrderCount(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return '--'
  return `${Math.round(count)}单`
}

export interface DailyReportRawOrderRow {
  orderId: string
  orderTime: string
  payTime: string
  shipTime: string
  finishTime: string
  closeTime: string
  productName: string
  skuName: string
  quantity: number | null
  orderAmount: number | null
  payAmount: number | null
  shippedAmount: number | null
  refundAmount: number | null
  shippingFee: number | null
  orderStatus: string
  afterSaleStatus: string
  refundStatus: string
  anchorName: string
  matchedLiveSession: string
  liveAccountName: string
  shopName: string
  isLowPriceOrder: boolean
  isClosed: boolean
  isAfterSaleCompleted: boolean
  isRefunded: boolean
  isFreightRefundOnly: boolean
  includedInGmv: boolean
  gmvExcludeReason: string
  rawSource: string
}

export interface DailyReportRawLiveSessionRow {
  anchorName: string
  startTime: string
  endTime: string
  durationMinutes: number
  liveName: string
}

export interface DailyReportRawChatGptPayload {
  range: {
    start: string
    end: string
    label: string
  }
  rawOrders: DailyReportRawOrderRow[]
  liveSessions: DailyReportRawLiveSessionRow[]
}

function displayRawValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number' && !Number.isFinite(value)) return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  const text = String(value).trim()
  return text || '—'
}

function formatRawMoney(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '—'
  return yuan.toFixed(2)
}

export function sanitizeRawOrderForChatGpt(order: DailyReportRawOrderRow): DailyReportRawOrderRow {
  return { ...order }
}

function formatRawOrderBlock(order: DailyReportRawOrderRow, index: number): string {
  return [
    `【订单 ${index + 1}】`,
    `- 订单号：${displayRawValue(order.orderId)}`,
    `- 下单时间：${displayRawValue(order.orderTime)}`,
    `- 支付时间：${displayRawValue(order.payTime)}`,
    `- 发货时间：${displayRawValue(order.shipTime)}`,
    `- 完成时间：${displayRawValue(order.finishTime)}`,
    `- 关闭时间：${displayRawValue(order.closeTime)}`,
    `- 商品名称：${displayRawValue(order.productName)}`,
    `- SKU/规格：${displayRawValue(order.skuName)}`,
    `- 件数：${displayRawValue(order.quantity)}`,
    `- 订单金额：${formatRawMoney(order.orderAmount)}`,
    `- 实付金额：${formatRawMoney(order.payAmount)}`,
    `- 发货金额/计入金额：${formatRawMoney(order.shippedAmount)}`,
    `- 退款金额：${formatRawMoney(order.refundAmount)}`,
    `- 运费：${formatRawMoney(order.shippingFee)}`,
    `- 订单状态：${displayRawValue(order.orderStatus)}`,
    `- 售后状态：${displayRawValue(order.afterSaleStatus)}`,
    `- 退款状态：${displayRawValue(order.refundStatus)}`,
    `- 是否已关闭：${displayRawValue(order.isClosed)}`,
    `- 是否售后完成：${displayRawValue(order.isAfterSaleCompleted)}`,
    `- 是否低价刷单：${displayRawValue(order.isLowPriceOrder)}`,
    `- 是否纯运费退款：${displayRawValue(order.isFreightRefundOnly)}`,
    `- 匹配主播：${displayRawValue(order.anchorName)}`,
    `- 匹配直播时间段：${displayRawValue(order.matchedLiveSession)}`,
    `- 店铺名称：${displayRawValue(order.shopName)}`,
    `- 原始平台：${displayRawValue(order.rawSource)}`,
  ].join('\n')
}

export function buildChatGptRawOrderPrompt(data: DailyReportRawChatGptPayload): string {
  const liveSessionLines =
    data.liveSessions.length > 0
      ? data.liveSessions
          .map(
            (session) =>
              `- ${session.anchorName}：${session.startTime}~${session.endTime}（${session.durationMinutes}分钟）`,
          )
          .join('\n')
      : '—'

  const orderBlocks = data.rawOrders.map((order, index) => formatRawOrderBlock(order, index)).join('\n\n')

  return [
    '请根据下面这批“小红书原始订单业务数据”和直播时间段，帮我分析主播昨日/当前时间段业绩，并生成可以放进日报图片里的“AI建议”。',
    '',
    '要求：',
    '1. 只输出 2~3 条建议。',
    '2. 每条一句话。',
    '3. 用老板能看懂的大白话。',
    '4. 可以分析已关闭、售后完成、退款、低价刷单对业绩的影响。',
    '5. 不要编造订单。',
    '6. 不要编造主播名字。',
    '7. 不要编造金额。',
    '8. 不要重新定义系统口径。',
    '9. 可以指出哪个主播真实成交好、哪个主播售后/关闭偏多、哪个主播成交密度低、哪个主播客单价高但单量少。',
    '10. 输出格式直接用：',
    '',
    'AI建议：',
    '1. ...',
    '2. ...',
    '3. ...',
    '',
    '分析时间段：',
    `开始：${displayRawValue(data.range.start)}`,
    `结束：${displayRawValue(data.range.end)}`,
    '',
    '直播时间段：',
    liveSessionLines,
    '',
    '订单原始数据：',
    orderBlocks || '—',
    '',
    '数据说明：',
    '1. 下面是当前时间段内的小红书原始订单业务数据。',
    '2. 数据包含已关闭、售后完成、退款、低价刷单订单。',
    '3. 请基于订单状态和售后状态分析，不要只看总金额。',
    '4. 买家隐私字段已剔除。',
  ].join('\n')
}

/** 解析用户粘贴的 AI 建议，最多 3 条 */
export function normalizeAiSuggestionText(raw: string): string[] {
  const text = raw.trim()
  if (!text) return []

  let body = text.replace(/^AI建议[:：]?\s*/i, '').trim()
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const items: string[] = []
  for (const line of lines) {
    const matched = line.match(/^(?:\d+[.、)]\s*|[-•*]\s*)?(.+)$/)
    const content = (matched?.[1] ?? line).trim()
    if (content) items.push(content)
    if (items.length >= 3) break
  }

  if (items.length === 0 && body) {
    return [body.slice(0, 200)]
  }
  return items.slice(0, 3)
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fallback below
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
