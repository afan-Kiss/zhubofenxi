/**
 * 统一退货退款 / 仅退款分类（主播业绩 returnRefundCount 唯一入口）
 *
 * 优先级：
 * 1. 成功售后原始记录 return_type / return_type_name
 * 2. afterSaleAgg.hasReturnRefund / 结构化缓存字段
 * 3. classifyOrderAfterSale.countsAsReturnRefund（订单状态含明确退货语义）
 * 4. 成功售后状态含退货完成/已寄回等
 * 5. 无法确定 → unknown（前端显示 --，不得静默为 0）
 */
import type { AfterSaleClassification } from './after-sale-classification.service'
import type { AfterSaleOrderAggregate } from './xhs-after-sales-range.service'
import { isReturnRefundAfterSaleRecord, normalizeAfterSaleRecord } from './xhs-after-sales-range.service'
import { isSuccessfulAfterSale } from './strict-after-sale-metrics.service'
import {
  pickReturnsV3ReturnTypeName,
  isReturnsV3UnshippedRefundOnly,
  isReturnsV3FreightOnlyRefund,
} from './returns-v3-record.service'
import { classifyAfterSaleRecord } from './classify-after-sale-record.service'

export type ResolvedAfterSaleProductType =
  | 'return_refund'
  | 'refund_only'
  | 'freight_only'
  | 'unknown'
  | 'none'

export type ReturnRefundClassificationSource =
  | 'raw_return_type'
  | 'after_sale_agg'
  | 'structured_cache'
  | 'order_classification'
  | 'success_status_keywords'
  | 'none'
  | 'unknown'

const RETURN_SUCCESS_STATUS_KEYWORDS = [
  '退货退款成功',
  '退货完成',
  '已寄回',
  '买家已退货',
  '商家已收货',
  '退货成功',
]

export interface StructuredAfterSaleTypeCache {
  hasReturnRefund?: boolean | null
  hasRefundOnly?: boolean | null
  returnRefundCount?: number | null
  refundOnlyCount?: number | null
  afterSaleType?: string | null
  returnTypeCodes?: string | null
  classificationSource?: string | null
}

export interface ResolveReturnRefundInput {
  /** 是否已确认有真实商品退款（金额>0，非运费、非取消） */
  hasSuccessfulProductRefund: boolean
  /** 是否纯运费退款 */
  isFreightRefundOnly?: boolean
  rawAfterSales?: Record<string, unknown>[] | null
  afterSaleAgg?: AfterSaleOrderAggregate | null
  structuredCache?: StructuredAfterSaleTypeCache | null
  classification?: Pick<
    AfterSaleClassification,
    'countsAsReturnRefund' | 'countsAsRefundOnly' | 'isReturnRefund' | 'isRefundOnly' | 'isFreightRefundOnly'
  > | null
  orderStatusText?: string | null
  afterSaleStatusText?: string | null
  workbenchAfterSaleStatus?: string | null
}

export interface ResolveReturnRefundResult {
  resolvedAfterSaleType: ResolvedAfterSaleProductType
  isReturnRefundOrder: boolean
  isRefundOnlyOrder: boolean
  typeKnown: boolean
  classificationSource: ReturnRefundClassificationSource
  returnTypeCodes: string[]
}

function collectText(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function isExplicitReturnRefundText(text: string): boolean {
  if (!text) return false
  if (/仅退款|未发货仅退款|已发货仅退款/.test(text) && !/退货/.test(text)) return false
  return (
    RETURN_SUCCESS_STATUS_KEYWORDS.some((k) => text.includes(k)) ||
    (text.includes('退货') && text.includes('退款')) ||
    /需要寄回|退货完成|退货退款/.test(text)
  )
}

function isExplicitRefundOnlyText(text: string): boolean {
  if (!text) return false
  if (isExplicitReturnRefundText(text)) return false
  return /仅退款|未发货仅退款|已发货仅退款/.test(text)
}

function classifyRawRecordType(rec: Record<string, unknown>): ResolvedAfterSaleProductType | null {
  if (!isSuccessfulAfterSale(rec)) return null
  const classified = classifyAfterSaleRecord(rec)
  if (classified.isFreightOnlyRefund || isReturnsV3FreightOnlyRefund(rec)) return 'freight_only'
  if (!classified.isProductRefund && classified.productRefundAmountCent <= 0) return null

  const typeName = pickReturnsV3ReturnTypeName(rec)
  const rt = rec.return_type ?? rec.returnType
  if (rt === 1 || rt === '1' || (/退货/.test(typeName) && !/仅退款/.test(typeName))) {
    return 'return_refund'
  }
  if (
    rt === 4 ||
    rt === '4' ||
    rt === 5 ||
    rt === '5' ||
    /仅退款|未发货仅退款|已发货仅退款/.test(typeName) ||
    isReturnsV3UnshippedRefundOnly(rec)
  ) {
    return 'refund_only'
  }

  const norm = normalizeAfterSaleRecord(rec)
  if (norm && isReturnRefundAfterSaleRecord(norm)) return 'return_refund'
  return null
}

/** 从原始售后列表推导结构化分类（写入缓存 / 回填） */
export function deriveStructuredAfterSaleTypeFromRaw(
  rawDetail: unknown,
): StructuredAfterSaleTypeCache & {
  hasReturnRefund: boolean
  hasRefundOnly: boolean
  returnRefundCount: number
  refundOnlyCount: number
  afterSaleType: string
  returnTypeCodes: string
  classificationSource: string
} {
  const empty = {
    hasReturnRefund: false,
    hasRefundOnly: false,
    returnRefundCount: 0,
    refundOnlyCount: 0,
    afterSaleType: 'none',
    returnTypeCodes: '',
    classificationSource: 'none',
  }
  if (!rawDetail || !Array.isArray(rawDetail) || rawDetail.length === 0) return empty

  const codes: string[] = []
  let returnRefundCount = 0
  let refundOnlyCount = 0
  let freightOnly = false
  let sawSuccessProduct = false

  for (const item of rawDetail) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const rt = rec.return_type ?? rec.returnType
    if (rt != null && String(rt).trim()) codes.push(String(rt).trim())
    const t = classifyRawRecordType(rec)
    if (t === 'return_refund') {
      returnRefundCount += 1
      sawSuccessProduct = true
    } else if (t === 'refund_only') {
      refundOnlyCount += 1
      sawSuccessProduct = true
    } else if (t === 'freight_only') {
      freightOnly = true
    } else if (isSuccessfulAfterSale(rec)) {
      const classified = classifyAfterSaleRecord(rec)
      if (classified.isProductRefund) sawSuccessProduct = true
    }
  }

  const hasReturnRefund = returnRefundCount > 0
  const hasRefundOnly = refundOnlyCount > 0
  let afterSaleType = 'none'
  if (hasReturnRefund) afterSaleType = 'return_refund'
  else if (hasRefundOnly) afterSaleType = 'refund_only'
  else if (freightOnly && !sawSuccessProduct) afterSaleType = 'freight_only'
  else if (sawSuccessProduct) afterSaleType = 'unknown'

  return {
    hasReturnRefund,
    hasRefundOnly,
    returnRefundCount,
    refundOnlyCount,
    afterSaleType,
    returnTypeCodes: [...new Set(codes)].join(','),
    classificationSource: 'raw_return_type',
  }
}

export function resolveReturnRefundClassification(
  input: ResolveReturnRefundInput,
): ResolveReturnRefundResult {
  const none: ResolveReturnRefundResult = {
    resolvedAfterSaleType: 'none',
    isReturnRefundOrder: false,
    isRefundOnlyOrder: false,
    typeKnown: true,
    classificationSource: 'none',
    returnTypeCodes: [],
  }

  if (input.isFreightRefundOnly) {
    return {
      ...none,
      resolvedAfterSaleType: 'freight_only',
      classificationSource: 'order_classification',
    }
  }

  if (!input.hasSuccessfulProductRefund) {
    return none
  }

  const codes: string[] = []

  // 1) 成功售后原始记录
  if (input.rawAfterSales && input.rawAfterSales.length > 0) {
    let sawReturn = false
    let sawRefundOnly = false
    let sawUnknownSuccess = false
    for (const rec of input.rawAfterSales) {
      const rt = rec.return_type ?? rec.returnType
      if (rt != null && String(rt).trim()) codes.push(String(rt).trim())
      const t = classifyRawRecordType(rec)
      if (t === 'return_refund') sawReturn = true
      else if (t === 'refund_only') sawRefundOnly = true
      else if (t === null && isSuccessfulAfterSale(rec)) {
        const c = classifyAfterSaleRecord(rec)
        if (c.isProductRefund) sawUnknownSuccess = true
      }
    }
    if (sawReturn) {
      return {
        resolvedAfterSaleType: 'return_refund',
        isReturnRefundOrder: true,
        isRefundOnlyOrder: false,
        typeKnown: true,
        classificationSource: 'raw_return_type',
        returnTypeCodes: [...new Set(codes)],
      }
    }
    if (sawRefundOnly) {
      return {
        resolvedAfterSaleType: 'refund_only',
        isReturnRefundOrder: false,
        isRefundOnlyOrder: true,
        typeKnown: true,
        classificationSource: 'raw_return_type',
        returnTypeCodes: [...new Set(codes)],
      }
    }
    if (sawUnknownSuccess) {
      // 有成功商品退款但 return_type 无法识别 → 继续向下兜底
    }
  }

  // 2) afterSaleAgg / 结构化缓存
  const structured = input.structuredCache
  if (structured?.hasReturnRefund === true || input.afterSaleAgg?.hasReturnRefund === true) {
    return {
      resolvedAfterSaleType: 'return_refund',
      isReturnRefundOrder: true,
      isRefundOnlyOrder: false,
      typeKnown: true,
      classificationSource: input.afterSaleAgg?.hasReturnRefund
        ? 'after_sale_agg'
        : 'structured_cache',
      returnTypeCodes: structured?.returnTypeCodes
        ? structured.returnTypeCodes.split(',').filter(Boolean)
        : codes,
    }
  }
  if (structured?.hasRefundOnly === true) {
    return {
      resolvedAfterSaleType: 'refund_only',
      isReturnRefundOrder: false,
      isRefundOnlyOrder: true,
      typeKnown: true,
      classificationSource: 'structured_cache',
      returnTypeCodes: structured.returnTypeCodes
        ? structured.returnTypeCodes.split(',').filter(Boolean)
        : codes,
    }
  }
  if (structured?.afterSaleType === 'return_refund') {
    return {
      resolvedAfterSaleType: 'return_refund',
      isReturnRefundOrder: true,
      isRefundOnlyOrder: false,
      typeKnown: true,
      classificationSource: 'structured_cache',
      returnTypeCodes: codes,
    }
  }
  if (structured?.afterSaleType === 'refund_only') {
    return {
      resolvedAfterSaleType: 'refund_only',
      isReturnRefundOrder: false,
      isRefundOnlyOrder: true,
      typeKnown: true,
      classificationSource: 'structured_cache',
      returnTypeCodes: codes,
    }
  }

  // 3) classifyOrderAfterSale：仅接受明确退货语义，不把泛化「退款成功」当仅退款定论
  const cls = input.classification
  if (cls?.countsAsReturnRefund || cls?.isReturnRefund) {
    return {
      resolvedAfterSaleType: 'return_refund',
      isReturnRefundOrder: true,
      isRefundOnlyOrder: false,
      typeKnown: true,
      classificationSource: 'order_classification',
      returnTypeCodes: codes,
    }
  }

  const statusText = collectText(
    input.orderStatusText,
    input.afterSaleStatusText,
    input.workbenchAfterSaleStatus,
  )

  // 4) 成功售后状态关键词
  if (isExplicitReturnRefundText(statusText)) {
    return {
      resolvedAfterSaleType: 'return_refund',
      isReturnRefundOrder: true,
      isRefundOnlyOrder: false,
      typeKnown: true,
      classificationSource: 'success_status_keywords',
      returnTypeCodes: codes,
    }
  }

  if (isExplicitRefundOnlyText(statusText) || (cls?.countsAsRefundOnly && /仅退款/.test(statusText))) {
    return {
      resolvedAfterSaleType: 'refund_only',
      isReturnRefundOrder: false,
      isRefundOnlyOrder: true,
      typeKnown: true,
      classificationSource: 'success_status_keywords',
      returnTypeCodes: codes,
    }
  }

  // 5) 有真实退款但无法区分类型
  return {
    resolvedAfterSaleType: 'unknown',
    isReturnRefundOrder: false,
    isRefundOnlyOrder: false,
    typeKnown: false,
    classificationSource: 'unknown',
    returnTypeCodes: codes,
  }
}
