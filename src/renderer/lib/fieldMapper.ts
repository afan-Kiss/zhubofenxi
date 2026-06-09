import type { ExcelFileType } from '../types/import'
import type {
  FieldDefinition,
  FieldMappingEntry,
  FieldMappingResult,
  MatchConfidence,
} from '../types/fieldMapping'

export const ORDER_FIELD_DEFS: FieldDefinition[] = [
  {
    key: 'orderId',
    label: '订单号',
    required: true,
    keywords: ['订单号', '主订单编号', '订单编号', '子订单号', '包裹单号', '商户订单号'],
  },
  {
    key: 'orderTime',
    label: '下单时间',
    required: true,
    keywords: ['下单时间', '订单创建时间', '创建时间', '支付时间', '成交时间'],
  },
  {
    key: 'gmvAmount',
    label: 'GMV金额',
    required: true,
    keywords: [
      '商家应收金额（支付金额）',
      '商家应收金额',
      '支付金额',
      '实付金额',
      '商品支付金额',
      '订单金额',
      '成交金额',
      'GMV',
    ],
  },
  {
    key: 'orderStatus',
    label: '订单状态',
    keywords: ['订单状态', '包裹状态', '物流状态', '交易状态'],
  },
  {
    key: 'afterSaleStatus',
    label: '售后状态',
    keywords: ['售后状态', '退款状态', '退货状态', '维权状态'],
  },
  {
    key: 'buyerId',
    label: '买家ID',
    keywords: ['买家ID', '买家 ID', '用户ID', '用户 ID', '买家昵称', '用户昵称', '小红书号', '客户ID', '客户昵称'],
  },
  {
    key: 'refundReason',
    label: '退款/售后原因',
    keywords: ['售后原因', '退款原因', '退货原因', '买家申请原因', '问题描述', '申请原因'],
  },
]

export const LIVE_FIELD_DEFS: FieldDefinition[] = [
  {
    key: 'liveStart',
    label: '直播开始时间',
    recommended: true,
    keywords: ['开始时间', '直播开始时间', '开播时间', '场次开始时间'],
  },
  {
    key: 'liveEnd',
    label: '直播结束时间',
    recommended: true,
    keywords: ['结束时间', '直播结束时间', '下播时间', '场次结束时间'],
  },
  {
    key: 'anchor',
    label: '主播',
    keywords: ['主播', '主播名称', '达人', '直播间', '账号名称'],
  },
  {
    key: 'livePayAmount',
    label: '直播支付金额',
    keywords: ['直播支付金额', '支付金额', 'GMV', '成交金额'],
  },
]

export const PENDING_SETTLEMENT_FIELD_DEFS: FieldDefinition[] = [
  {
    key: 'pendingOrderId',
    label: '订单号',
    required: true,
    keywords: ['订单号', '主订单编号', '订单编号', '子订单号', '商户订单号', '交易单号'],
  },
  {
    key: 'pendingAmount',
    label: '待结算金额',
    required: true,
    keywords: [
      '待结算金额',
      '预计结算金额',
      '应结金额',
      '货款金额',
      '结算金额',
      '订单收入',
      '商家实收',
      '实收金额',
    ],
  },
  {
    key: 'pendingStatus',
    label: '待结算状态',
    keywords: ['账单状态', '结算状态', '收支类型', '交易类型', '业务类型'],
  },
  {
    key: 'pendingOrderTime',
    label: '订单时间',
    keywords: ['下单时间', '支付时间', '订单创建时间', '交易时间'],
  },
]

export const SETTLED_SETTLEMENT_FIELD_DEFS: FieldDefinition[] = [
  {
    key: 'settledOrderId',
    label: '订单号',
    required: true,
    keywords: ['订单号', '主订单编号', '订单编号', '子订单号', '商户订单号', '交易单号'],
  },
  {
    key: 'settledAmount',
    label: '已结算金额',
    required: true,
    keywords: ['已结算金额', '实结金额', '入账金额', '结算金额', '实收金额', '商家实收', '货款金额', '订单收入'],
  },
  {
    key: 'settledTime',
    label: '结算时间',
    keywords: ['结算时间', '入账时间', '到账时间', '账单时间', '交易时间'],
  },
  {
    key: 'settledStatus',
    label: '结算状态',
    keywords: ['结算状态', '账单状态', '状态', '收支类型', '业务类型'],
  },
]

export function getFieldDefsForType(fileType: ExcelFileType): FieldDefinition[] {
  switch (fileType) {
    case 'order':
      return ORDER_FIELD_DEFS
    case 'live':
      return LIVE_FIELD_DEFS
    case 'pendingSettlement':
      return PENDING_SETTLEMENT_FIELD_DEFS
    case 'settledSettlement':
      return SETTLED_SETTLEMENT_FIELD_DEFS
    default:
      return []
  }
}

/** 归一化：去空格、括号内容、标点，转小写 */
export function normalizeForMatch(text: string): string {
  return text
    .trim()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[\s_\-/\\.:：,，、;；]/g, '')
    .toLowerCase()
}

interface MatchScore {
  header: string
  confidence: MatchConfidence
  score: number
}

function scoreHeaderAgainstKeyword(header: string, keyword: string): MatchScore | null {
  const nh = normalizeForMatch(header)
  const nk = normalizeForMatch(keyword)
  if (!nh || !nk) return null

  if (nh === nk) {
    return { header, confidence: 'exact', score: 100 }
  }

  if (nh.includes(nk) || nk.includes(nh)) {
    const ratio = Math.min(nh.length, nk.length) / Math.max(nh.length, nk.length)
    return { header, confidence: 'fuzzy', score: 50 + ratio * 40 }
  }

  return null
}

function findBestHeader(
  headers: string[],
  keywords: string[],
  usedHeaders: Set<string>,
): MatchScore | null {
  let best: MatchScore | null = null

  for (const header of headers) {
    if (usedHeaders.has(header)) continue

    for (const keyword of keywords) {
      const scored = scoreHeaderAgainstKeyword(header, keyword)
      if (!scored) continue
      if (!best || scored.score > best.score) {
        best = scored
      }
    }
  }

  return best
}

export function autoMapFields(
  headers: string[],
  defs: FieldDefinition[],
  manualOverrides?: Record<string, string | null>,
): FieldMappingEntry[] {
  const usedHeaders = new Set<string>()
  const entries: FieldMappingEntry[] = []

  for (const def of defs) {
    const manual = manualOverrides?.[def.key]
    if (manual !== undefined) {
      if (manual) usedHeaders.add(manual)
      entries.push({
        key: def.key,
        label: def.label,
        header: manual,
        confidence: manual ? 'manual' : 'missing',
        required: Boolean(def.required),
      })
      continue
    }

    const best = findBestHeader(headers, def.keywords, usedHeaders)
    if (best) {
      usedHeaders.add(best.header)
      entries.push({
        key: def.key,
        label: def.label,
        header: best.header,
        confidence: best.confidence,
        required: Boolean(def.required),
      })
    } else {
      entries.push({
        key: def.key,
        label: def.label,
        header: null,
        confidence: 'missing',
        required: Boolean(def.required),
      })
    }
  }

  return entries
}

function collectMissingRequired(mappings: FieldMappingEntry[]): string[] {
  return mappings
    .filter((m) => m.required && !m.header)
    .map((m) => m.label)
}

function collectLiveWarnings(mappings: FieldMappingEntry[]): string[] {
  const start = mappings.find((m) => m.key === 'liveStart')
  const end = mappings.find((m) => m.key === 'liveEnd')
  if (!start?.header || !end?.header) {
    return ['直播场次字段不完整，将使用时间规则归属主播']
  }
  return []
}

export function buildFieldMappingResult(
  fileId: string,
  fileName: string,
  fileType: ExcelFileType,
  headers: string[],
  manualOverrides?: Record<string, string | null>,
): FieldMappingResult | null {
  const defs = getFieldDefsForType(fileType)
  if (!defs.length || headers.length === 0) return null

  const mappings = autoMapFields(headers, defs, manualOverrides)
  const missingRequiredFields = collectMissingRequired(mappings)
  const warnings: string[] = []

  if (fileType === 'order' && missingRequiredFields.length > 0) {
    warnings.push('订单表缺少关键字段，无法开始统计')
  }

  if (fileType === 'pendingSettlement' && missingRequiredFields.length > 0) {
    warnings.push('待结算明细缺少关键字段，无法进行结算分析')
  }

  if (fileType === 'settledSettlement' && missingRequiredFields.length > 0) {
    warnings.push('已结算明细缺少关键字段，无法进行结算分析')
  }

  if (fileType === 'settledSettlement') {
    const settledTime = mappings.find((m) => m.key === 'settledTime')
    if (!settledTime?.header) {
      warnings.push('缺少结算时间，无法按结算月份分析，只能按订单匹配对账')
    }
  }

  if (fileType === 'live') {
    warnings.push(...collectLiveWarnings(mappings))
  }

  return {
    fileId,
    fileType,
    fileName,
    mappings,
    missingRequiredFields,
    warnings,
  }
}

export function getGlobalAlerts(
  orderMapping: FieldMappingResult | null,
  liveMapping: FieldMappingResult | null,
  pendingMapping: FieldMappingResult | null,
  settledMapping: FieldMappingResult | null,
): { type: 'error' | 'warning'; message: string }[] {
  const alerts: { type: 'error' | 'warning'; message: string }[] = []

  if (orderMapping?.missingRequiredFields.length) {
    alerts.push({ type: 'error', message: '订单表缺少关键字段，无法开始统计' })
  }

  if (pendingMapping?.missingRequiredFields.length) {
    alerts.push({ type: 'error', message: '待结算明细缺少关键字段，无法进行结算分析' })
  }

  if (settledMapping?.missingRequiredFields.length) {
    alerts.push({ type: 'error', message: '已结算明细缺少关键字段，无法进行结算分析' })
  }

  if (settledMapping?.warnings.some((w) => w.includes('缺少结算时间'))) {
    alerts.push({
      type: 'warning',
      message: '缺少结算时间，无法按结算月份分析，只能按订单匹配对账',
    })
  }

  if (liveMapping?.warnings.some((w) => w.includes('直播场次'))) {
    alerts.push({
      type: 'warning',
      message: '直播场次字段不完整，将使用时间规则归属主播',
    })
  }

  return alerts
}
