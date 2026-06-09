import type { FieldMappingResult } from '../types/fieldMapping'
import type { ImportedExcelFile } from '../types/import'
import type { SettlementDirection, SettlementRecord, SettlementType } from '../types/settlement'
import { parseMoneyToCent } from './money'
import { isRefundStatus } from './status'
import { formatDateTime, parseDateTime } from './time'
import { extractDataRowsFromFile } from './excelRows'

function getMappedHeader(mapping: FieldMappingResult, key: string): string | null {
  return mapping.mappings.find((m) => m.key === key)?.header ?? null
}

function cellValue(row: Record<string, unknown>, header: string | null): unknown {
  return header ? row[header] : ''
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
  file: ImportedExcelFile,
  mapping: FieldMappingResult,
  settlementType: SettlementType,
): SettlementRecord[] {
  const extracted = extractDataRowsFromFile(file)
  if (!extracted) return []

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
      ? getMappedHeader(mapping, 'pendingOrderTime')
      : getMappedHeader(mapping, 'settledTime')

  return extracted.dataRows.map((row, index) => {
    const sourceRowIndex = extracted.headerRowIndex + 1 + index + 1
    const errors: string[] = []

    const orderId = String(cellValue(row, orderIdHeader) ?? '').trim()
    if (!orderId) errors.push('缺少订单号')

    const moneyParsed = parseMoneyToCent(cellValue(row, amountHeader))
    const amountCent = moneyParsed.ok ? moneyParsed.cent : 0
    if (!moneyParsed.ok) errors.push('金额解析失败')

    const statusText = String(cellValue(row, statusHeader) ?? '').trim()
    const direction = detectDirection(amountCent, statusText)

    let settlementTime: Date | undefined
    let settlementTimeText: string | undefined
    const timeRaw = cellValue(row, timeHeader)

    if (timeHeader) {
      const parsed = parseDateTime(timeRaw)
      if (parsed.ok) {
        settlementTime = parsed.date
        settlementTimeText = formatDateTime(parsed.date)
      } else if (settlementType === 'settled' && String(timeRaw ?? '').trim() !== '') {
        errors.push('结算时间解析失败')
      } else if (settlementType === 'settled' && !String(timeRaw ?? '').trim()) {
        errors.push('结算时间解析失败')
      }
    } else if (settlementType === 'settled') {
      errors.push('结算时间解析失败')
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
