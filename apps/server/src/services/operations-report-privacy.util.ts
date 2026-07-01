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

function maskName(name: string): string {
  const t = name.trim()
  if (!t) return ''
  if (t.length === 1) return '*'
  if (t.length === 2) return `${t[0]}*`
  return `${t[0]}${'*'.repeat(Math.max(1, t.length - 2))}${t[t.length - 1]}`
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return phone ? '****' : ''
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

function maskAddress(address: string): string {
  const t = address.trim()
  if (!t) return ''
  return t.replace(/\d+号.*$/, '').replace(/\d+$/, '').trim() || t.slice(0, 8)
}

export function sanitizeDailyReportRawOrderRow(row: DailyReportRawOrderRow): DailyReportRawOrderRow {
  return {
    ...row,
    receiverName: maskName(row.receiverName),
    receiverPhone: maskPhone(row.receiverPhone),
    receiverAddress: maskAddress(row.receiverAddress),
    buyerNickname: maskName(row.buyerNickname),
    buyerDisplayName: maskName(row.buyerDisplayName),
    platformRawJson: '',
  }
}

export function shouldIncludeRawPlatformJson(params: {
  role?: string
  confirmRaw?: boolean
}): boolean {
  return params.role === 'super_admin' && params.confirmRaw === true
}
