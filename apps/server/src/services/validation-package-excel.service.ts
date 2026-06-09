import ExcelJS from 'exceljs'
import type { ExportAnalysisBundle } from './analysis-pipeline.service'
import type { OrderAttribution } from '../types/analysis'
import { centToYuan } from '../utils/money'

const CNY = '¥#,##0.00'

function styleHeader(sheet: ExcelJS.Worksheet, colCount: number): void {
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (colCount > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } }
  }
}

async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

function buildOrderBillMap(bundle: ExportAnalysisBundle): Map<
  string,
  { settledCent: number; pendingCent: number; refundCent: number; feeCent: number }
> {
  const settlement = bundle.context.settlement ?? {
    pendingRecords: [],
    settledRecords: [],
    abnormalPendingRecords: [],
    abnormalSettledRecords: [],
  }
  const orderIds = new Set(bundle.context.orderDedupe.uniqueOrders.map((o) => o.orderId))
  const map = new Map<
    string,
    { settledCent: number; pendingCent: number; refundCent: number; feeCent: number }
  >()
  const touch = (id: string) => {
    if (!map.has(id)) {
      map.set(id, { settledCent: 0, pendingCent: 0, refundCent: 0, feeCent: 0 })
    }
    return map.get(id)!
  }
  for (const r of [
    ...settlement.pendingRecords,
    ...settlement.settledRecords,
    ...settlement.abnormalPendingRecords,
    ...settlement.abnormalSettledRecords,
  ]) {
    if (!r.orderId || !orderIds.has(r.orderId)) continue
    const b = touch(r.orderId)
    if (r.direction === 'income') {
      if (r.settlementType === 'pending') b.pendingCent += r.amountCent
      else b.settledCent += r.amountCent
    } else if (r.direction === 'refund') {
      b.refundCent += Math.abs(r.amountCent)
    } else if (r.direction === 'fee') {
      b.feeCent += Math.abs(r.amountCent)
    }
  }
  return map
}

export async function buildOrderAttributionWorkbook(
  bundle: ExportAnalysisBundle,
  attributions: Map<number, OrderAttribution>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('订单归属')
  const headers = [
    '订单号',
    '下单时间',
    '买家ID',
    'GMV(元)',
    '归属主播',
    '归属方式',
    '匹配规则',
    '直播场次ID',
    '直播开始',
    '直播结束',
    '是否签收',
    '是否退货',
    '是否品退',
    '异常原因',
  ]
  sheet.addRow(headers)
  const ordersById = new Map(
    bundle.context.orderDedupe.uniqueOrders.map((o) => [o.orderId, o]),
  )
  for (const v of bundle.context.views) {
    const order = ordersById.get(v.orderId)
    const attr = order ? attributions.get(order.sourceRowIndex) : undefined
    sheet.addRow([
      v.orderId,
      v.orderTimeText,
      v.buyerId,
      centToYuan(v.gmvCent),
      v.anchorName,
      v.attributionType,
      attr?.matchedRuleName ?? v.matchedRuleName ?? '',
      attr?.matchedLiveSessionId ?? '',
      attr?.matchedLiveStartTime ?? v.matchedLiveStartTime ?? '',
      attr?.matchedLiveEndTime ?? v.matchedLiveEndTime ?? '',
      order?.isSigned ? '是' : '否',
      v.isReturned ? '是' : '否',
      v.isQualityReturn ? '是' : '否',
      order?.errors.join('；') ?? '',
    ])
  }
  styleHeader(sheet, headers.length)
  sheet.getColumn(4).numFmt = CNY
  return workbookToBuffer(wb)
}

export async function buildSettlementMatchWorkbook(bundle: ExportAnalysisBundle): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('结算匹配')
  const headers = [
    '订单号',
    '归属主播',
    '订单GMV(元)',
    '实际签收金额(元)',
    '已结算金额(元)',
    '待结算金额(元)',
    '退款扣回(元)',
    '平台扣费(元)',
    '匹配状态',
    '差额(元)',
    '说明',
  ]
  sheet.addRow(headers)
  const billMap = buildOrderBillMap(bundle)
  const ordersById = new Map(
    bundle.context.orderDedupe.uniqueOrders.map((o) => [o.orderId, o]),
  )
  for (const v of bundle.context.views) {
    const order = ordersById.get(v.orderId)
    const bill = billMap.get(v.orderId) ?? {
      settledCent: 0,
      pendingCent: 0,
      refundCent: 0,
      feeCent: 0,
    }
    const signed = order?.actualSignedAmountCent ?? 0
    const actual = bill.settledCent + bill.pendingCent - bill.refundCent - bill.feeCent
    const diff = signed - actual
    const ok = Math.abs(diff) < 1
    sheet.addRow([
      v.orderId,
      v.anchorName,
      centToYuan(v.gmvCent),
      centToYuan(signed),
      centToYuan(bill.settledCent),
      centToYuan(bill.pendingCent),
      centToYuan(bill.refundCent),
      centToYuan(bill.feeCent),
      ok ? 'matched' : 'difference',
      centToYuan(diff),
      ok ? '' : '签收与账单汇总存在差额，请人工核对',
    ])
  }
  styleHeader(sheet, headers.length)
  for (let c = 3; c <= 10; c++) sheet.getColumn(c).numFmt = CNY
  return workbookToBuffer(wb)
}

export async function buildAbnormalOrdersWorkbook(bundle: ExportAnalysisBundle): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('异常订单')
  sheet.addRow(['原始行号', '订单号', '异常类型', '异常原因'])
  for (const a of bundle.result.abnormalOrders) {
    sheet.addRow([a.sourceRowIndex, a.orderId, '分析异常', a.errors.join('；')])
  }
  for (const o of bundle.context.orderDedupe.abnormalOrders) {
    sheet.addRow([o.sourceRowIndex, o.orderId, '解析异常', o.errors.join('；')])
  }
  styleHeader(sheet, 4)
  return workbookToBuffer(wb)
}

export async function buildUnassignedOrdersWorkbook(bundle: ExportAnalysisBundle): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('未归属订单')
  sheet.addRow(['订单号', '下单时间', 'GMV(元)', '买家ID', '未归属原因'])
  const ordersById = new Map(
    bundle.context.orderDedupe.uniqueOrders.map((o) => [o.orderId, o]),
  )
  for (const u of bundle.result.unassignedOrders) {
    sheet.addRow([
      u.orderId,
      u.orderTimeText,
      centToYuan(u.gmvCent),
      ordersById.get(u.orderId)?.buyerId ?? '',
      u.reason,
    ])
  }
  styleHeader(sheet, 5)
  sheet.getColumn(3).numFmt = CNY
  return workbookToBuffer(wb)
}
