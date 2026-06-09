import ExcelJS from 'exceljs'
import path from 'node:path'
import type { ExportAnalysisBundle } from './analysis-pipeline.service'
import type { DashboardOverviewResponse } from './dashboard-api.service'
import type {
  AnalyzedOrderView,
  AttributionType,
  NormalizedOrder,
  SettlementRecord,
} from '../types/analysis'
import type { DataValidationReport } from '../types/data-validation'
import { TRUST_STATUS_HINTS } from '../types/data-validation'
import { centToYuan } from '../utils/money'
import { buildShortRiskHints } from './data-validation.service'

const ATTRIBUTION_LABELS: Record<AttributionType, string> = {
  order_anchor_field: '订单主播字段',
  live_anchor_field: '直播字段',
  live_time_rule: '直播场次',
  time_rule: '时段规则',
  unassigned: '未归属',
  abnormal: '异常',
}

const CNY = '¥#,##0.00'
const PCT = '0.00%'

function y(cent: number): number {
  return centToYuan(cent)
}

function isFullCalendarMonth(start: string, end: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false
  if (start.slice(0, 7) !== end.slice(0, 7)) return false
  if (!start.endsWith('-01')) return false
  const [y, m] = start.split('-').map(Number)
  const last = new Date(y!, m!, 0).getDate()
  return end === `${start.slice(0, 7)}-${String(last).padStart(2, '0')}`
}

export function buildReportFileName(startDate: string, endDate: string): string {
  if (isFullCalendarMonth(startDate, endDate)) {
    return `直播订单经营报表_${startDate.slice(0, 7)}.xlsx`
  }
  return `直播订单经营报表_${startDate}至${endDate}.xlsx`
}

function styleSheetHeader(sheet: ExcelJS.Worksheet, colCount: number): void {
  const row = sheet.getRow(1)
  row.font = { bold: true }
  row.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (colCount > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } }
  }
}

function autoWidth(sheet: ExcelJS.Worksheet, max = 48): void {
  sheet.columns.forEach((col) => {
    let w = 10
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value == null ? '' : String(cell.value)
      w = Math.max(w, Math.min(max, v.length + 2))
    })
    col.width = w
  })
}

function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
  opts?: {
    moneyCols?: number[]
    pctCols?: number[]
    redIf?: (row: (string | number | boolean | null | undefined)[], rowIdx: number) => void
  },
): void {
  const sheet = wb.addWorksheet(name)
  sheet.addRow(headers)
  rows.forEach((r) => sheet.addRow(r))
  styleSheetHeader(sheet, headers.length)
  opts?.moneyCols?.forEach((c) => {
    sheet.getColumn(c).numFmt = CNY
  })
  opts?.pctCols?.forEach((c) => {
    sheet.getColumn(c).numFmt = PCT
  })
  if (opts?.redIf) {
    rows.forEach((r, i) => {
      const rowNum = i + 2
      opts.redIf!(r, rowNum)
    })
  }
  autoWidth(sheet)
}

interface OrderBill {
  settledCent: number
  pendingCent: number
  refundCent: number
  feeCent: number
}

function buildOrderBillMap(
  records: SettlementRecord[],
  orderIds: Set<string>,
): Map<string, OrderBill> {
  const map = new Map<string, OrderBill>()
  const touch = (id: string): OrderBill => {
    if (!map.has(id)) {
      map.set(id, { settledCent: 0, pendingCent: 0, refundCent: 0, feeCent: 0 })
    }
    return map.get(id)!
  }
  for (const r of records) {
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

function orderDateKey(order: NormalizedOrder | undefined, fallback: string): string {
  if (!order) return fallback.slice(0, 10) || '—'
  if (order.orderTimeText.length >= 10) return order.orderTimeText.slice(0, 10)
  return order.monthKey || '—'
}

export async function generateBusinessReportExcel(
  outputPath: string,
  dashboard: DashboardOverviewResponse & { startDate: string; endDate: string },
  bundle: ExportAnalysisBundle,
): Promise<void> {
  const { context, validation, result } = bundle
  const trust = dashboard.trust.status
  const ordersById = new Map(
    context.orderDedupe.uniqueOrders.map((o) => [o.orderId, o]),
  )
  const orderIds = new Set(ordersById.keys())
  const settlement = context.settlement ?? {
    pendingRecords: [],
    settledRecords: [],
    abnormalPendingRecords: [],
    abnormalSettledRecords: [],
  }
  const settlementRecords = [
    ...settlement.pendingRecords,
    ...settlement.settledRecords,
    ...settlement.abnormalPendingRecords,
    ...settlement.abnormalSettledRecords,
  ]
  const billByOrder = buildOrderBillMap(settlementRecords, orderIds)
  const views = context.views

  const wb = new ExcelJS.Workbook()
  wb.creator = '直播经营分析'
  wb.created = new Date()

  const home = wb.addWorksheet('汇报首页')
  home.mergeCells('A1:F1')
  const title = home.getCell('A1')
  title.value = '直播订单经营分析汇报'
  title.font = { size: 18, bold: true, color: { argb: 'FF1E293B' } }
  title.alignment = { horizontal: 'center' }

  if (trust === 'preview_only' || trust === 'blocked') {
    home.mergeCells('A2:F2')
    const warn = home.getCell('A2')
    warn.value =
      trust === 'blocked'
        ? '⚠ 当前数据异常，禁止正式汇报'
        : '⚠ 当前数据仅供预览，不建议正式汇报'
    warn.font = { bold: true, size: 12, color: { argb: trust === 'blocked' ? 'FFB91C1C' : 'FFB45309' } }
    warn.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: trust === 'blocked' ? 'FFFEE2E2' : 'FFFFEDD5' },
    }
    warn.alignment = { horizontal: 'center' }
  }

  const kv: [string, string | number][] = [
    ['分析时间范围', dashboard.periodLabel],
    ['统计起止', `${dashboard.startDate} 至 ${dashboard.endDate}`],
    ['最近刷新时间', dashboard.lastUpdatedAt ?? '—'],
    ['数据可信状态', dashboard.trust.statusLabel],
    ['总 GMV', dashboard.gmv],
    ['总订单数', dashboard.orderCount],
    ['实际签收单数', dashboard.actualSignedCount],
    ['实际签收金额', dashboard.actualSignedAmount],
    ['退货单数', dashboard.returnCount],
    ['退货金额', dashboard.returnAmount],
    ['退货率', dashboard.returnRate],
    ['品退单数', dashboard.qualityReturnCount],
    ['品退金额', dashboard.qualityReturnAmount],
    ['品退率', dashboard.qualityReturnRate],
    ['已结算金额', dashboard.settledAmount],
    ['待结算金额', dashboard.pendingAmount],
    ['毛利润（不算成本）', dashboard.grossProfit],
  ]

  let row = trust === 'preview_only' || trust === 'blocked' ? 4 : 3
  for (const [k, v] of kv) {
    home.getCell(`A${row}`).value = k
    home.getCell(`A${row}`).font = { bold: true }
    const cell = home.getCell(`B${row}`)
    cell.value = v
    if (typeof v === 'number' && k.includes('率')) {
      cell.numFmt = PCT
    } else if (typeof v === 'number' && (k.includes('金额') || k.includes('GMV') || k.includes('利润'))) {
      cell.numFmt = CNY
    }
    row += 1
  }

  row += 1
  home.getCell(`A${row}`).value = '主播核心数据'
  home.getCell(`A${row}`).font = { bold: true, size: 12 }
  row += 1
  for (const a of dashboard.anchorSummaries) {
    home.getCell(`A${row}`).value = a.anchorName
    home.getCell(`B${row}`).value = `GMV ${dashboard.gmv > 0 ? '' : ''}${a.gmv}`
    home.getCell(`C${row}`).value = `签收 ${a.actualSignedCount} 单 · 毛利 ${a.grossProfit}`
    row += 1
  }

  row += 1
  home.getCell(`A${row}`).value = '数据风险提醒'
  home.getCell(`A${row}`).font = { bold: true, color: { argb: 'FFB45309' } }
  row += 1
  const risks = buildShortRiskHints(trust, validation)
  if (risks.length === 0) risks.push('暂无额外风险')
  for (const r of risks) {
    home.getCell(`A${row}`).value = `· ${r}`
    row += 1
  }

  row += 1
  home.getCell(`A${row}`).value = '运营结论摘要'
  home.getCell(`A${row}`).font = { bold: true }
  row += 1
  const conclusion =
    trust === 'official_ready'
      ? '数据校验通过，可作为正式经营汇报依据。'
      : trust === 'preview_only'
        ? TRUST_STATUS_HINTS.preview_only
        : TRUST_STATUS_HINTS.blocked
  home.mergeCells(`A${row}:F${row + 2}`)
  home.getCell(`A${row}`).value = conclusion
  home.getColumn(1).width = 22
  home.getColumn(2).width = 28

  const totalGmv = result.overview.gmvCent
  addTableSheet(
    wb,
    '主播汇总',
    [
      '主播',
      'GMV',
      'GMV占比',
      '订单数',
      '订单占比',
      '实际签收单数',
      '实际签收金额',
      '实际签收金额占比',
      '退货单数',
      '退货金额',
      '退货率',
      '品退单数',
      '品退金额',
      '品退率',
      '已结算金额',
      '待结算金额',
      '毛利润（不算成本）',
    ],
    result.anchorSummaries.map((a) => {
      const returns = views.filter((v) => v.anchorName === a.anchorName && v.isReturned)
      const returnAmt = returns.reduce((s, v) => s + v.returnAmountCent, 0)
      const qr = views.filter((v) => v.anchorName === a.anchorName && v.isQualityReturn)
      const qrAmt = qr.reduce((s, v) => s + v.returnAmountCent, 0)
      return [
        a.anchorName,
        y(a.gmvCent),
        a.gmvShare,
        a.orderCount,
        totalGmv > 0 ? a.gmvCent / totalGmv : 0,
        a.actualSignedCount,
        y(a.actualSignedAmountCent),
        a.actualSignedShare,
        a.returnCount,
        y(returnAmt),
        a.returnRate,
        a.qualityReturnCount,
        y(a.qualityReturnAmountCent),
        a.orderCount > 0 ? a.qualityReturnCount / a.orderCount : 0,
        y(a.settledAmountCent),
        y(a.pendingAmountCent),
        y(a.grossProfitCent),
      ]
    }),
    {
      moneyCols: [2, 7, 10, 13, 15, 16, 17],
      pctCols: [3, 5, 8, 11, 14],
      redIf: (r, rowNum) => {
        const rate = Number(r[10])
        if (rate > 0.5) {
          wb.getWorksheet('主播汇总')!.getRow(rowNum).getCell(11).font = {
            color: { argb: 'FFB91C1C' },
          }
        }
        const qrRate = Number(r[13])
        if (qrRate > 0.15) {
          wb.getWorksheet('主播汇总')!.getRow(rowNum).getCell(14).font = {
            color: { argb: 'FFB45309' },
          }
        }
      },
    },
  )

  const dailyMap = new Map<
    string,
    {
      gmv: number
      orders: number
      signed: number
      signedAmt: number
      returns: number
      returnAmt: number
      qr: number
      qrAmt: number
      settled: number
      pending: number
      profit: number
    }
  >()
  for (const v of views) {
    const order = ordersById.get(v.orderId)
    const date = orderDateKey(order, v.orderTimeText)
    const key = `${date}|${v.anchorName}`
    const cur = dailyMap.get(key) ?? {
      gmv: 0,
      orders: 0,
      signed: 0,
      signedAmt: 0,
      returns: 0,
      returnAmt: 0,
      qr: 0,
      qrAmt: 0,
      settled: 0,
      pending: 0,
      profit: 0,
    }
    cur.gmv += v.gmvCent
    cur.orders += 1
    if (v.isActualSigned) {
      cur.signed += 1
      cur.signedAmt += order?.actualSignedAmountCent ?? v.gmvCent
    }
    if (v.isReturned) {
      cur.returns += 1
      cur.returnAmt += v.returnAmountCent
    }
    if (v.isQualityReturn) {
      cur.qr += 1
      cur.qrAmt += v.returnAmountCent
    }
    const bill = billByOrder.get(v.orderId)
    if (bill) {
      cur.settled += bill.settledCent
      cur.pending += bill.pendingCent
    }
    dailyMap.set(key, cur)
  }

  addTableSheet(
    wb,
    '每日汇总',
    [
      '日期',
      '主播',
      'GMV',
      '订单数',
      '实际签收单数',
      '实际签收金额',
      '退货单数',
      '退货金额',
      '退货率',
      '品退单数',
      '品退金额',
      '已结算金额',
      '待结算金额',
      '毛利润',
    ],
    [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, d]) => {
        const [date, anchor] = key.split('|')
        return [
          date,
          anchor,
          y(d.gmv),
          d.orders,
          d.signed,
          y(d.signedAmt),
          d.returns,
          y(d.returnAmt),
          d.orders > 0 ? d.returns / d.orders : 0,
          d.qr,
          y(d.qrAmt),
          y(d.settled),
          y(d.pending),
          y(d.signedAmt - d.returnAmt),
        ]
      }),
    { moneyCols: [3, 6, 8, 11, 12, 13, 14], pctCols: [9] },
  )

  addTableSheet(
    wb,
    '订单明细_归属',
    [
      '订单号',
      '下单时间',
      '买家ID',
      'GMV',
      '是否签收',
      '是否退货',
      '是否品退',
      '实际签收金额',
      '归属主播',
      '归属方式',
      '匹配直播场次',
      '订单状态',
      '售后状态',
      '售后原因',
      '异常原因',
    ],
    views.map((v) => {
      const order = ordersById.get(v.orderId)
      const live =
        v.matchedLiveStartTime && v.matchedLiveEndTime
          ? `${v.matchedLiveStartTime} ~ ${v.matchedLiveEndTime}`
          : v.matchedRuleName ?? ''
      return [
        v.orderId,
        v.orderTimeText,
        v.buyerId,
        y(v.gmvCent),
        order?.isSigned ? '是' : '否',
        v.isReturned ? '是' : '否',
        v.isQualityReturn ? '是' : '否',
        y(order?.actualSignedAmountCent ?? 0),
        v.anchorName,
        ATTRIBUTION_LABELS[v.attributionType],
        live,
        order?.orderStatusText ?? '',
        order?.afterSaleStatusText ?? '',
        v.reasonText,
        order?.errors.join('；') ?? '',
      ]
    }),
    { moneyCols: [4, 8] },
  )

  addTableSheet(
    wb,
    '账单对账明细',
    [
      '订单号',
      '归属主播',
      '订单GMV',
      '实际签收金额',
      '已结算金额',
      '待结算金额',
      '退款/扣回金额',
      '平台扣费金额',
      '对账状态',
      '差额说明',
    ],
    views.map((v) => {
      const order = ordersById.get(v.orderId)
      const bill = billByOrder.get(v.orderId) ?? {
        settledCent: 0,
        pendingCent: 0,
        refundCent: 0,
        feeCent: 0,
      }
      const signed = order?.actualSignedAmountCent ?? 0
      const expected = signed
      const actual = bill.settledCent + bill.pendingCent - bill.refundCent - bill.feeCent
      const diff = expected - actual
      const ok = Math.abs(diff) < 1
      return [
        v.orderId,
        v.anchorName,
        y(v.gmvCent),
        y(signed),
        y(bill.settledCent),
        y(bill.pendingCent),
        y(bill.refundCent),
        y(bill.feeCent),
        ok ? '一致' : '有差额',
        ok ? '' : `差额约 ${y(Math.abs(diff))}`,
      ]
    }),
    {
      moneyCols: [3, 4, 5, 6, 7, 8],
      redIf: (_r, rowNum) => {
        const status = wb.getWorksheet('账单对账明细')!.getRow(rowNum).getCell(9).value
        if (status === '有差额') {
          wb.getWorksheet('账单对账明细')!.getRow(rowNum).getCell(10).font = {
            color: { argb: 'FFB91C1C' },
          }
        }
      },
    },
  )

  const buyerAnchorMap = new Map<string, Set<string>>()
  for (const v of views.filter((x) => x.isReturned)) {
    if (!buyerAnchorMap.has(v.buyerId)) buyerAnchorMap.set(v.buyerId, new Set())
    buyerAnchorMap.get(v.buyerId)!.add(v.anchorName)
  }

  addTableSheet(
    wb,
    '买家退货排行',
    ['排名', '买家ID', '退货单数', '退货金额', '最近退货时间', '涉及主播', '备注'],
    result.buyerReturnRanking.map((b, i) => [
      i + 1,
      b.buyerId,
      b.returnCount,
      y(b.returnAmountCent),
      b.latestReturnTime,
      [...(buyerAnchorMap.get(b.buyerId) ?? [])].join('、'),
      '',
    ]),
    { moneyCols: [4] },
  )

  addTableSheet(
    wb,
    '买家品退排行',
    ['排名', '买家ID', '品退单数', '品退金额', '品退原因摘要', '最近品退时间', '涉及主播'],
    result.buyerQualityReturnRanking.map((b, i) => {
      const anchors = new Set<string>()
      views
        .filter((v) => v.buyerId === b.buyerId && v.isQualityReturn)
        .forEach((v) => anchors.add(v.anchorName))
      return [
        i + 1,
        b.buyerId,
        b.qualityReturnCount,
        y(b.qualityReturnAmountCent),
        b.reasonSummary,
        '',
        [...anchors].join('、'),
      ]
    }),
    { moneyCols: [4] },
  )

  addTableSheet(
    wb,
    '退货品退明细',
    [
      '订单号',
      '买家ID',
      '主播',
      '下单时间',
      'GMV',
      '退货金额',
      '是否品退',
      '品退原因',
      '售后状态',
    ],
    result.returnDetails.map((d) => {
      const order = ordersById.get(d.orderId)
      return [
        d.orderId,
        d.buyerId,
        d.anchorName,
        order?.orderTimeText ?? '',
        y(d.gmvCent),
        y(order?.isReturned ? order.actualSignedAmountCent || d.gmvCent : 0),
        d.isQualityReturn ? '是' : '否',
        d.reasonText,
        order?.afterSaleStatusText ?? '',
      ]
    }),
    { moneyCols: [5, 6] },
  )

  addTableSheet(
    wb,
    '未归属订单',
    ['订单号', '下单时间', 'GMV', '买家ID', '未归属原因'],
    result.unassignedOrders.map((u) => [
      u.orderId,
      u.orderTimeText,
      y(u.gmvCent),
      ordersById.get(u.orderId)?.buyerId ?? '',
      u.reason,
    ]),
    { moneyCols: [3] },
  )

  addTableSheet(
    wb,
    '异常订单',
    ['原始行号', '订单号', '异常类型', '异常原因', '原始数据摘要'],
    [
      ...result.abnormalOrders.map((a) => [
        a.sourceRowIndex,
        a.orderId,
        '订单异常',
        a.errors.join('；'),
        '',
      ]),
      ...context.orderDedupe.abnormalOrders.map((o) => [
        o.sourceRowIndex,
        o.orderId,
        '解析异常',
        o.errors.join('；'),
        JSON.stringify(o.raw).slice(0, 200),
      ]),
    ],
  )

  const downloadOk = validation.completeness.orderOk && validation.completeness.errors.length === 0
  const checkRows: (string | number)[][] = [
    [
      '下载完整性校验',
      downloadOk ? '通过' : '未通过',
      validation.completeness.warnings[0] ?? validation.completeness.errors[0] ?? '—',
      downloadOk ? '低' : '高',
    ],
    ['日期范围校验', validation.errors.some((e) => e.includes('日期')) ? '警告' : '通过', validation.warnings.find((w) => w.includes('日期')) ?? '—', '中'],
    [
      '订单数量对账',
      validation.orderAttribution?.ok ? '通过' : '待核',
      validation.orderAttribution?.message ?? `归属 ${validation.orderAttribution?.anchorOrderCount ?? 0} 单`,
      '中',
    ],
    ['GMV 对账', validation.gmvReconciliation?.ok ? '通过' : '待核', validation.gmvReconciliation?.message ?? '—', validation.gmvReconciliation?.ok ? '低' : '高'],
    [
      '结算匹配校验',
      validation.settlementReconciliation ? '已核对' : '待核',
      validation.settlementReconciliation
        ? `已结算匹配 ${validation.settlementReconciliation.settledMatchedCount} · 待结算 ${validation.settlementReconciliation.pendingMatchedCount}`
        : '—',
      '中',
    ],
    ['数据可信状态', dashboard.trust.statusLabel, dashboard.trust.statusHint, trust === 'official_ready' ? '低' : '高'],
  ]

  addTableSheet(wb, '数据校验', ['校验项', '状态', '说明', '风险级别'], checkRows)

  const defs = wb.addWorksheet('口径说明')
  const lines = [
    '1. GMV 口径：订单表去重后，按归属主播统计的订单成交金额（元）。',
    '2. 订单数口径：去重后的有效订单条数。',
    '3. 实际签收口径：订单标记为已签收且计入实际签收金额的订单。',
    '4. 退货口径：订单标记为退货/退款状态的订单数与金额。',
    '5. 品退口径：售后原因命中品退规则的退货订单。',
    '6. 毛利润口径：实际签收金额 − 退货金额 − 平台扣费（不算商品成本）。',
    '7. 主播归属规则：优先直播场次/直播字段，其次时段规则，无法匹配则未归属。',
    '8. 订单去重规则：同一订单号多行取金额一致合并，不一致记异常。',
    '9. 已结算/待结算匹配规则：按订单号关联待结算与已结算明细。',
    '10. 跨月结算处理规则：结算时间可跨分析月，以账单记录为准。',
    '11. 数据可信状态：official_ready 可汇报；preview_only 仅预览；blocked 禁止汇报。',
  ]
  lines.forEach((t, i) => {
    defs.getCell(`A${i + 1}`).value = t
    defs.getCell(`A${i + 1}`).alignment = { wrapText: true }
  })
  defs.getColumn(1).width = 90

  await wb.xlsx.writeFile(outputPath)
}
