import type { ExcelParseResult } from '../types/analysis'
import type { FieldMappingResult, NormalizedOrder } from '../types/analysis'
import { collectReasonText, findReasonHeaders } from '../utils/quality-return'
import { parseMoneyToCent } from '../utils/money'
import { buildStatusFlags } from '../utils/status'
import { formatDateTime, getMonthKey, parseDateTime } from '../utils/time'

function getMappedHeader(mapping: FieldMappingResult, key: string): string | null {
  return mapping.mappings.find((m) => m.key === key)?.header ?? null
}

function cellValue(row: Record<string, unknown>, header: string | null): unknown {
  return header ? row[header] : ''
}

export function normalizeOrders(
  parsed: ExcelParseResult,
  mapping: FieldMappingResult,
): NormalizedOrder[] {
  const orderIdHeader = getMappedHeader(mapping, 'orderId')
  const orderTimeHeader = getMappedHeader(mapping, 'orderTime')
  const gmvHeader = getMappedHeader(mapping, 'gmvAmount')
  const orderStatusHeader = getMappedHeader(mapping, 'orderStatus')
  const afterSaleHeader = getMappedHeader(mapping, 'afterSaleStatus')
  const buyerHeader = getMappedHeader(mapping, 'buyerId')
  const reasonHeader = getMappedHeader(mapping, 'refundReason')
  const reasonHeaders = reasonHeader ? [reasonHeader] : findReasonHeaders(parsed.headers)

  return parsed.rows.map((row, index) => {
    const sourceRowIndex = index + 2
    const errors: string[] = []

    const orderId = String(cellValue(row, orderIdHeader) ?? '').trim()
    if (!orderId) errors.push('缺少订单号')

    const timeRaw = cellValue(row, orderTimeHeader)
    const timeParsed = parseDateTime(timeRaw)
    let orderTime: Date | null = null
    let orderTimeText = String(timeRaw ?? '').trim()
    let monthKey = ''

    if (!timeParsed.ok) {
      errors.push('时间解析失败')
    } else {
      orderTime = timeParsed.date
      orderTimeText = formatDateTime(timeParsed.date)
      monthKey = getMonthKey(timeParsed.date)
    }

    const buyerId = String(cellValue(row, buyerHeader) ?? '').trim() || '未知买家'
    const reasonText = collectReasonText(row, reasonHeaders)

    const gmvParsed = parseMoneyToCent(cellValue(row, gmvHeader))
    let gmvCent = 0
    if (!gmvParsed.ok) {
      errors.push('金额解析失败')
    } else {
      gmvCent = gmvParsed.cent
    }

    const statusFlags = buildStatusFlags(row, {
      orderStatus: orderStatusHeader,
      afterSaleStatus: afterSaleHeader,
    })

    const isReturned = statusFlags.isRefunded
    const actualSigned = statusFlags.isSigned && !isReturned
    const actualSignedAmountCent = actualSigned && gmvParsed.ok ? gmvCent : 0
    const isQualityReturn = false

    const matchOrderId = orderId
    return {
      sourceRowIndex,
      orderId,
      packageId: '',
      bizOrderId: orderId,
      officialOrderNo: orderId,
      displayOrderNo: orderId,
      matchOrderId,
      orderTime,
      orderTimeText,
      monthKey,
      buyerId,
      gmvCent,
      productAmountCent: gmvCent,
      receivableAmountCent: 0,
      freightCent: 0,
      platformDiscountCent: 0,
      actualPaidCent: 0,
      actualSellerReceiveAmountCent: 0,
      gmvSourceUsed: 'excel_gmv_column',
      amountWarnings: [],
      orderStatusText: statusFlags.orderStatusText,
      afterSaleStatusText: statusFlags.afterSaleStatusText,
      reasonText,
      isSigned: statusFlags.isSigned,
      isReturned,
      isQualityReturn,
      actualSigned,
      actualSignedAmountCent,
      errors,
      raw: row,
    }
  })
}
