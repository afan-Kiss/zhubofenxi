import type { FieldMappingResult } from '../types/fieldMapping'
import type { StandardOrder } from '../types/order'
import { extractDataRowsFromFile } from './excelRows'
import type { ImportedExcelFile } from '../types/import'
import { parseMoneyToCent } from './money'
import { buildStatusFlags } from './status'
import { collectReasonText, findReasonHeaders } from './qualityReturn'
import { formatDateTime, getMonthKey, parseDateTime } from './time'

function getMappedHeader(
  mapping: FieldMappingResult | null,
  key: string,
): string | null {
  if (!mapping) return null
  const item = mapping.mappings.find((m) => m.key === key)
  return item?.header ?? null
}

function cellValue(row: Record<string, unknown>, header: string | null): unknown {
  if (!header) return ''
  return row[header] ?? ''
}

export function normalizeOrders(
  file: ImportedExcelFile,
  mapping: FieldMappingResult,
): StandardOrder[] {
  const extracted = extractDataRowsFromFile(file)
  if (!extracted) return []

  const orderIdHeader = getMappedHeader(mapping, 'orderId')
  const orderTimeHeader = getMappedHeader(mapping, 'orderTime')
  const gmvHeader = getMappedHeader(mapping, 'gmvAmount')
  const orderStatusHeader = getMappedHeader(mapping, 'orderStatus')
  const afterSaleHeader = getMappedHeader(mapping, 'afterSaleStatus')
  const buyerHeader = getMappedHeader(mapping, 'buyerId')
  const reasonHeader = getMappedHeader(mapping, 'refundReason')
  const reasonHeaders = reasonHeader
    ? [reasonHeader]
    : findReasonHeaders(extracted.headers)

  const statusMapping = {
    orderStatus: orderStatusHeader,
    afterSaleStatus: afterSaleHeader,
  }

  return extracted.dataRows.map((row, index) => {
    const sourceRowIndex = extracted.headerRowIndex + 1 + index + 1
    const errors: string[] = []

    const orderIdRaw = cellValue(row, orderIdHeader)
    const orderId = String(orderIdRaw ?? '').trim()
    if (!orderId) {
      errors.push('缺少订单号')
    }

    const timeRaw = cellValue(row, orderTimeHeader)
    const timeParsed = parseDateTime(timeRaw)
    let orderTime: Date | null = null
    let orderTimeText = String(timeRaw ?? '').trim()

    let monthKey = ''
    if (!timeParsed.ok) {
      errors.push(timeParsed.error === '时间为空' ? '时间解析失败' : timeParsed.error)
    } else {
      orderTime = timeParsed.date
      orderTimeText = formatDateTime(timeParsed.date)
      monthKey = getMonthKey(timeParsed.date)
    }

    const buyerId = String(cellValue(row, buyerHeader) ?? '').trim() || '未知买家'
    const reasonText = collectReasonText(row, reasonHeaders)

    const gmvRaw = cellValue(row, gmvHeader)
    const gmvParsed = parseMoneyToCent(gmvRaw)
    let gmvCent = 0
    if (!gmvParsed.ok) {
      errors.push(gmvParsed.error === '金额为空' ? '金额解析失败' : gmvParsed.error)
    } else {
      gmvCent = gmvParsed.cent
    }

    const statusFlags = buildStatusFlags(row, statusMapping)
    const effectiveSignedCent =
      statusFlags.isSigned && !statusFlags.isRefunded && gmvParsed.ok ? gmvCent : 0

    return {
      sourceRowIndex,
      orderId,
      orderTime,
      orderTimeText,
      monthKey,
      gmvCent,
      orderStatusText: statusFlags.orderStatusText,
      afterSaleStatusText: statusFlags.afterSaleStatusText,
      reasonText,
      buyerId,
      isSigned: statusFlags.isSigned,
      isRefunded: statusFlags.isRefunded,
      effectiveSignedCent,
      errors,
      raw: row,
    }
  })
}
