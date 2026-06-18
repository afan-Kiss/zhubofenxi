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
  packageId: string
  bizOrderId: string
  matchOrderId: string
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
  freightRefundAmount: number | null
  shippingFee: number | null
  platformDiscount: number | null
  sellerReceiveAmount: number | null
  signedAmount: number | null
  actualSignedAmount: number | null
  orderStatus: string
  afterSaleStatus: string
  refundStatus: string
  afterSaleCategory: string
  afterSaleReason: string
  finalAfterSaleReason: string
  anchorName: string
  anchorId: string
  attributionType: string
  matchedRuleName: string
  matchedLiveSession: string
  matchedLiveStartTime: string
  matchedLiveEndTime: string
  liveAccountId: string
  liveAccountName: string
  shopName: string
  buyerId: string
  buyerNickname: string
  buyerDisplayName: string
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  isLowPriceOrder: boolean
  isClosed: boolean
  isAfterSaleCompleted: boolean
  isRefunded: boolean
  isReturnRefund: boolean
  isRefundOnly: boolean
  isFreightRefundOnly: boolean
  isSigned: boolean
  isActualSigned: boolean
  isQualityReturn: boolean
  strictQualityRefund: boolean
  officialQualityBadCase: boolean
  includedInGmv: boolean
  gmvExcludeReason: string
  paymentBaseSource: string
  rawSource: string
  platformRawJson: string
}

export interface DailyReportRawLiveSessionRow {
  anchorName: string
  sessionLabel: string
  shopName: string
  liveAccountName: string
  startTime: string
  endTime: string
  startDateTime: string
  endDateTime: string
  durationMinutes: number
  durationText: string
  liveName: string
  liveId: string
}

export interface DailyReportAnchorLiveBlock {
  anchorName: string
  sessionLabel: string
  shopName: string
  livePeriodText: string
  totalDurationMinutes: number
  totalDurationText: string
  sessions: DailyReportRawLiveSessionRow[]
}

export interface DailyReportRawChatGptPayload {
  range: {
    start: string
    end: string
    label: string
  }
  anchorLiveBlocks: DailyReportAnchorLiveBlock[]
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

function formatAnchorLiveBlock(block: DailyReportAnchorLiveBlock): string {
  const sessionLines =
    block.sessions.length > 0
      ? block.sessions
          .map(
            (session, idx) =>
              [
                `  场次${idx + 1}：${displayRawValue(session.liveName)}`,
                `  直播号：${displayRawValue(session.liveAccountName)}`,
                `  开播：${displayRawValue(session.startDateTime)}`,
                `  下播：${displayRawValue(session.endDateTime)}`,
                `  时段：${displayRawValue(session.startTime)}~${displayRawValue(session.endTime)}`,
                `  时长：${displayRawValue(session.durationText)}（${displayRawValue(session.durationMinutes)}分钟）`,
                `  liveId：${displayRawValue(session.liveId)}`,
              ].join('\n'),
          )
          .join('\n')
      : '  （本场次暂无直播记录）'

  return [
    `【${displayRawValue(block.anchorName)}｜${displayRawValue(block.sessionLabel)}】`,
    `- 对应店铺/直播号：${displayRawValue(block.shopName)}`,
    `- 直播时段：${displayRawValue(block.livePeriodText)}`,
    `- 直播总时长：${displayRawValue(block.totalDurationText)}（${displayRawValue(block.totalDurationMinutes)}分钟）`,
    `- 场次明细：`,
    sessionLines,
  ].join('\n')
}

function formatRawOrderBlock(order: DailyReportRawOrderRow, index: number): string {
  const lines = [
    `【订单 ${index + 1}】`,
    `- 订单号：${displayRawValue(order.orderId)}`,
    `- 包裹号：${displayRawValue(order.packageId)}`,
    `- 业务单号：${displayRawValue(order.bizOrderId)}`,
    `- 匹配键：${displayRawValue(order.matchOrderId)}`,
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
    `- 商家实收：${formatRawMoney(order.sellerReceiveAmount)}`,
    `- 退款金额：${formatRawMoney(order.refundAmount)}`,
    `- 运费退款：${formatRawMoney(order.freightRefundAmount)}`,
    `- 运费：${formatRawMoney(order.shippingFee)}`,
    `- 平台优惠：${formatRawMoney(order.platformDiscount)}`,
    `- 签收金额：${formatRawMoney(order.signedAmount)}`,
    `- 有效签收金额：${formatRawMoney(order.actualSignedAmount)}`,
    `- 订单状态：${displayRawValue(order.orderStatus)}`,
    `- 售后状态：${displayRawValue(order.afterSaleStatus)}`,
    `- 退款状态：${displayRawValue(order.refundStatus)}`,
    `- 售后类型：${displayRawValue(order.afterSaleCategory)}`,
    `- 售后原因：${displayRawValue(order.afterSaleReason)}`,
    `- 最终售后原因：${displayRawValue(order.finalAfterSaleReason)}`,
    `- 是否已关闭：${displayRawValue(order.isClosed)}`,
    `- 是否售后完成：${displayRawValue(order.isAfterSaleCompleted)}`,
    `- 是否退货退款：${displayRawValue(order.isReturnRefund)}`,
    `- 是否仅退款：${displayRawValue(order.isRefundOnly)}`,
    `- 是否低价刷单：${displayRawValue(order.isLowPriceOrder)}`,
    `- 是否纯运费退款：${displayRawValue(order.isFreightRefundOnly)}`,
    `- 是否签收：${displayRawValue(order.isSigned)}`,
    `- 是否有效签收：${displayRawValue(order.isActualSigned)}`,
    `- 是否品退：${displayRawValue(order.isQualityReturn)}`,
    `- 官方品退命中：${displayRawValue(order.officialQualityBadCase)}`,
    `- 匹配主播：${displayRawValue(order.anchorName)}（${displayRawValue(order.anchorId)}）`,
    `- 归属方式：${displayRawValue(order.attributionType)}`,
    `- 命中时间段规则：${displayRawValue(order.matchedRuleName)}`,
    `- 匹配直播时间段：${displayRawValue(order.matchedLiveSession)}`,
    `- 匹配直播开始：${displayRawValue(order.matchedLiveStartTime)}`,
    `- 匹配直播结束：${displayRawValue(order.matchedLiveEndTime)}`,
    `- 来源直播号：${displayRawValue(order.liveAccountName)}（${displayRawValue(order.liveAccountId)}）`,
    `- 店铺名称：${displayRawValue(order.shopName)}`,
    `- 买家ID：${displayRawValue(order.buyerId)}`,
    `- 买家昵称：${displayRawValue(order.buyerNickname)}`,
    `- 买家展示名：${displayRawValue(order.buyerDisplayName)}`,
    `- 收件人：${displayRawValue(order.receiverName)}`,
    `- 收件电话：${displayRawValue(order.receiverPhone)}`,
    `- 收件地址：${displayRawValue(order.receiverAddress)}`,
    `- 计入GMV：${displayRawValue(order.includedInGmv)}`,
    `- 不计入原因：${displayRawValue(order.gmvExcludeReason)}`,
    `- 支付口径来源：${displayRawValue(order.paymentBaseSource)}`,
    `- 原始平台：${displayRawValue(order.rawSource)}`,
  ]
  if (order.platformRawJson) {
    lines.push(`- 平台原始JSON：${order.platformRawJson}`)
  }
  return lines.join('\n')
}

export function buildChatGptRawOrderPrompt(data: DailyReportRawChatGptPayload): string {
  const anchorBlocks =
    (data.anchorLiveBlocks?.length ?? 0) > 0
      ? data.anchorLiveBlocks.map((block) => formatAnchorLiveBlock(block)).join('\n\n')
      : data.liveSessions.length > 0
        ? data.liveSessions
            .map(
              (session) =>
                `- ${session.anchorName}｜${session.sessionLabel || session.anchorName}：${session.startDateTime || session.startTime}~${session.endDateTime || session.endTime}（${session.durationText || `${session.durationMinutes}分钟`}）直播号=${session.liveAccountName || session.shopName}`,
            )
            .join('\n')
        : '—'

  const orderBlocks = data.rawOrders.map((order, index) => formatRawOrderBlock(order, index)).join('\n\n')

  return [
    '请根据下面这批“小红书原始订单业务数据”和各主播直播场次，帮我分析主播昨日/当前时间段业绩，并生成可以放进日报图片里的“AI建议”。',
    '',
    '要求：',
    '1. 只输出 2~3 条建议。',
    '2. 每条一句话。',
    '3. 用老板能看懂的大白话。',
    '4. 可以分析已关闭、售后完成、退款、低价刷单、品退对业绩的影响。',
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
    '各主播直播场次（含开播/下播时间与时长）：',
    anchorBlocks,
    '',
    '订单原始数据（含买家、收件、售后、平台原始JSON，未脱敏）：',
    orderBlocks || '—',
    '',
    '数据说明：',
    '1. 下面是当前时间段内的小红书原始订单业务数据，字段尽量完整。',
    '2. 数据包含已关闭、售后完成、退款、低价刷单、品退订单。',
    '3. 每条订单末尾附有平台原始 JSON，可用于交叉核对。',
    '4. 各主播直播场次已按归属列出，时长为各场次直播时长相加。',
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
