import type { ExcelFileType, ImportFileStatus } from '../types/import'

const ORDER_ID_KEYS = ['订单号', '主订单编号', '订单编号', '子订单号', '包裹单号', '商户订单号']
const ORDER_TIME_KEYS = ['下单时间', '订单创建时间', '创建时间', '支付时间', '成交时间']
const ORDER_AMOUNT_KEYS = ['商家应收金额', '支付金额', '实付金额', '商品支付金额', '订单金额', '成交金额', 'GMV']
const LIVE_START_KEYS = ['开始时间', '直播开始时间', '开播时间', '场次开始时间']
const LIVE_END_KEYS = ['结束时间', '直播结束时间', '下播时间', '场次结束时间']

const SETTLEMENT_ORDER_KEYS = ['订单号', '主订单编号', '订单编号', '子订单号', '商户订单号', '交易单号']
const SETTLEMENT_STATUS_KEYS = ['结算状态', '账单状态', '状态', '收支类型', '业务类型']
const PENDING_AMOUNT_KEYS = ['待结算金额', '预计结算金额', '应结金额', '货款金额', '结算金额', '订单收入', '商家实收', '实收金额']
const SETTLED_AMOUNT_KEYS = ['已结算金额', '实结金额', '入账金额', '结算金额', '实收金额', '商家实收', '货款金额']

const PENDING_FILE_KEYS = ['待结算', '未结算', '待入账', '待到账']
const SETTLED_FILE_KEYS = ['已结算', '已入账', '已到账', '结算明细']

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[\s_\-/\\.:：,，、;；（）()]/g, '')
    .toLowerCase()
}

function matchAny(headers: string[], keywords: string[]): boolean {
  const h = headers.map(normalizeText)
  const k = keywords.map(normalizeText)
  return k.some((kw) => h.some((hd) => hd.includes(kw) || kw.includes(hd)))
}

function fileNameHas(fileName: string, keywords: string[]): boolean {
  const n = normalizeText(fileName)
  return keywords.some((k) => n.includes(normalizeText(k)))
}

export function classifyByHeaders(headers: string[], fileName = ''): ExcelFileType {
  const hasOrder = matchAny(headers, ORDER_ID_KEYS) && matchAny(headers, ORDER_TIME_KEYS) && matchAny(headers, ORDER_AMOUNT_KEYS)
  const hasLive = matchAny(headers, LIVE_START_KEYS) && matchAny(headers, LIVE_END_KEYS)

  const pendingByName = fileNameHas(fileName, PENDING_FILE_KEYS)
  const settledByName = fileNameHas(fileName, SETTLED_FILE_KEYS)
  const hasSettlementOrder = matchAny(headers, SETTLEMENT_ORDER_KEYS)
  const hasSettlementStatus = matchAny(headers, SETTLEMENT_STATUS_KEYS)
  const hasPendingShape =
    hasSettlementOrder &&
    matchAny(headers, PENDING_AMOUNT_KEYS) &&
    (hasSettlementStatus || pendingByName)
  const hasSettledShape =
    hasSettlementOrder &&
    matchAny(headers, SETTLED_AMOUNT_KEYS) &&
    (hasSettlementStatus || settledByName)

  if (hasOrder) return 'order'
  if (hasLive) return 'live'
  if (pendingByName && hasPendingShape) return 'pendingSettlement'
  if (settledByName && hasSettledShape) return 'settledSettlement'
  if (pendingByName && hasSettledShape && !hasPendingShape) return 'pendingSettlement'
  if (settledByName && hasPendingShape && !hasSettledShape) return 'settledSettlement'
  if (hasPendingShape && !hasSettledShape) return 'pendingSettlement'
  if (hasSettledShape && !hasPendingShape) return 'settledSettlement'
  return 'unknown'
}

export function getFileTypeLabel(fileType: ExcelFileType): string {
  switch (fileType) {
    case 'order':
      return '当月订单表'
    case 'live':
      return '直播场次表'
    case 'pendingSettlement':
      return '待结算明细'
    case 'settledSettlement':
      return '已结算明细'
    default:
      return '未识别'
  }
}

export function getFileTypeOptions(): Array<{ value: ExcelFileType; label: string }> {
  return [
    { value: 'order', label: '当月订单表' },
    { value: 'live', label: '直播场次表' },
    { value: 'pendingSettlement', label: '待结算明细' },
    { value: 'settledSettlement', label: '已结算明细' },
    { value: 'unknown', label: '未识别' },
  ]
}

export function getStatusLabel(status: ImportFileStatus): string {
  switch (status) {
    case 'identified':
      return '已识别'
    case 'needs_confirm':
      return '需要确认'
    case 'error':
      return '异常'
    default:
      return '未知'
  }
}

export function resolveImportStatus(
  fileType: ExcelFileType,
  errorMessage?: string,
): ImportFileStatus {
  if (errorMessage) return 'error'
  if (fileType === 'unknown') return 'needs_confirm'
  return 'identified'
}
