import type { ExcelParseResult, FieldMappingResult, SettlementRecord, SettlementType } from '../types/analysis'
import { parseMoneyToCent } from '../utils/money'
import { isRefundStatus } from '../utils/status'
import { formatDateTime, parseDateTime } from '../utils/time'
import type { SettlementDirection } from '../types/analysis'

function getMappedHeader(mapping: FieldMappingResult, key: string): string | null {
  return mapping.mappings.find((m) => m.key === key)?.header ?? null
}

function detectDirection(amountCent: number, statusText: string): SettlementDirection {
  const text = statusText.trim()
  const feeKeywords = ['服务费', '佣金', '技术服务费', '平台扣费', '运费险', '扣费']
  if (feeKeywords.some((k) => text.includes(k))) return 'fee'
  if (amountCent < 0) return 'refund'
  if (isRefundStatus(text) || /退款|退货|扣回/.test(text)) return 'refund'
  if (amountCent > 0) return 'income'
  return 'unknown'
}

export function normalizeSettlementRecords(
  parsed: ExcelParseResult,
  mapping: FieldMappingResult,
  settlementType: SettlementType,
): SettlementRecord[] {
  const orderIdHeader =
    settlementType === 'pending'
      ? getMappedHeader(mapping, 'pendingOrderId')
      : getMappedHeader(mapping, 'settledOrderId')
  const amountHeader =
    settlementType === 'pending'
      ? getMappedHeader(mapping, 'pendingAmount')
      : getMappedHeader(mapping, 'settledAmount')
  const statusHeader =
    settlementType === 'pending'
      ? getMappedHeader(mapping, 'pendingStatus')
      : getMappedHeader(mapping, 'settledStatus')
  const timeHeader =
    settlementType === 'pending'
      ? null
      : getMappedHeader(mapping, 'settledTime')

  return parsed.rows.map((row, index) => {
    const sourceRowIndex = index + 2
    const errors: string[] = []

    const orderId = String(orderIdHeader ? row[orderIdHeader] : '').trim()
    if (!orderId) errors.push('缺少订单号')

    const moneyParsed = parseMoneyToCent(amountHeader ? row[amountHeader] : '')
    const amountCent = moneyParsed.ok ? moneyParsed.cent : 0
    if (!moneyParsed.ok) errors.push('金额解析失败')

    const statusText = String(statusHeader ? row[statusHeader] : '').trim()
    const direction = detectDirection(amountCent, statusText)

    let settlementTime: Date | undefined
    let settlementTimeText: string | undefined
    if (timeHeader) {
      const parsedTime = parseDateTime(row[timeHeader])
      if (parsedTime.ok) {
        settlementTime = parsedTime.date
        settlementTimeText = formatDateTime(parsedTime.date)
      }
    }

    return {
      sourceRowIndex,
      settlementType,
      orderId,
      amountCent,
      settlementTime,
      settlementTimeText,
      statusText,
      direction,
      errors,
      raw: row,
    }
  })
}
