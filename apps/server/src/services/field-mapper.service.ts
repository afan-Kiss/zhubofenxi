import type { DownloadType } from '../types/download'
import type { FieldDefinition, FieldMappingEntry, FieldMappingResult } from '../types/analysis'

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
      '商品总价(元)',
      '商品总价',
      '商品金额',
      '商品GMV',
      'GMV',
      '商品支付金额',
      '成交金额',
      '订单金额',
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
    label: '买家',
    keywords: ['买家ID', '买家 ID', '用户ID', '用户 ID', '买家昵称', '用户昵称', '小红书号', '客户ID', '客户昵称'],
  },
  {
    key: 'refundReason',
    label: '退款/售后原因',
    keywords: ['售后原因', '退款原因', '退货原因', '买家申请原因', '问题描述', '申请原因', '售后说明'],
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
    label: '状态',
    keywords: ['结算状态', '账单状态', '状态', '收支类型', '业务类型', '交易类型'],
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
    label: '状态',
    keywords: ['结算状态', '账单状态', '状态', '收支类型', '业务类型'],
  },
]

export function getFieldDefsForType(fileType: DownloadType): FieldDefinition[] {
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

export function normalizeForMatch(text: string): string {
  return text
    .trim()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[\s_\-/\\.:：,，、;；]/g, '')
    .toLowerCase()
}

type MatchConfidence = 'exact' | 'fuzzy' | 'manual' | 'missing'

interface MatchScore {
  header: string
  confidence: MatchConfidence
  score: number
}

function scoreHeaderAgainstKeyword(header: string, keyword: string): MatchScore | null {
  const nh = normalizeForMatch(header)
  const nk = normalizeForMatch(keyword)
  if (!nh || !nk) return null
  if (nh === nk) return { header, confidence: 'exact', score: 100 }
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
      if (!best || scored.score > best.score) best = scored
    }
  }
  return best
}

export function autoMapFields(headers: string[], defs: FieldDefinition[]): FieldMappingEntry[] {
  const usedHeaders = new Set<string>()
  const entries: FieldMappingEntry[] = []

  for (const def of defs) {
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

export function buildFieldMapping(
  fileType: DownloadType,
  fileName: string,
  headers: string[],
): FieldMappingResult {
  const defs = getFieldDefsForType(fileType)
  const mappings = autoMapFields(headers, defs)
  const missingRequiredFields = mappings.filter((m) => m.required && !m.header).map((m) => m.label)
  const warnings: string[] = []

  if (fileType === 'live') {
    const start = mappings.find((m) => m.key === 'liveStart')
    const end = mappings.find((m) => m.key === 'liveEnd')
    if (!start?.header || !end?.header) {
      warnings.push('直播场次字段不完整，将使用时间规则归属主播')
    }
  }

  return {
    fileId: fileName,
    fileType,
    fileName,
    mappings,
    missingRequiredFields,
    warnings,
  }
}

export function formatOrderFieldError(mapping: FieldMappingResult): string | null {
  if (mapping.missingRequiredFields.length === 0) return null
  return `订单表缺少${mapping.missingRequiredFields.join(' / ')}字段，请检查下载文件`
}
