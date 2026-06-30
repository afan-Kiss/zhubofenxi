import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import { centToYuan } from '../utils/money'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { getBoardScopedViewsForRange } from './board-scoped-views.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import {
  remapViewsWithScheduleOverlay,
  resolveAnchorWithScheduleOverlay,
  type ScheduleAttributionSource,
} from './anchor-schedule-attribution.service'
import { buildAnchorPocketSummary } from './anchor-pocket-revenue.service'
import {
  classifyAnchorPocketOrder,
  isBrushOrderPaidCent,
  isClosedOrCanceledOrderView,
  isPendingReceiveOrderView,
  isRefundProcessingOrderView,
  resolveRefundFinishedAmountCent,
} from './anchor-pocket-order.service'
import { resolvePaymentBaseCentForBrushCheck } from './low-price-brush-order.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import {
  bootstrapWorkbenchCache,
  buildLiveAccountOrderQueries,
  getWorkbenchRefundMapForOrders,
  loadWorkbenchRefundMapFromDb,
  mergeWorkbenchRefundMaps,
} from './xhs-after-sales-workbench.service'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { ANCHOR_SESSION_DISPLAY_FROM_0613 } from './anchor-performance-attribution.service'
import { listUnconfirmedScheduleDatesInRange } from './anchor-schedule-confirm.service'
import { getShopCookieStatusPayload } from './shop-cookie-upload.service'
import { parseViewPayTimeMs } from './anchor-performance-attribution.service'
import { lookupWorkbenchRefund } from '../utils/live-account-cache-key.util'

function styleHeader(sheet: ExcelJS.Worksheet, cols: number): void {
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (cols > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } }
  }
}

function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: unknown[][],
): void {
  const sheet = wb.addWorksheet(name)
  sheet.addRow(headers)
  for (const r of rows) sheet.addRow(r)
  styleHeader(sheet, headers.length)
}

export async function getEarliestOrderDateKey(): Promise<string | null> {
  const agg = await prisma.xhsRawOrder.aggregate({ _min: { orderTime: true } })
  if (!agg._min.orderTime) return null
  return formatDateKeyShanghai(agg._min.orderTime)
}

export async function countAnchorAuditExportOrders(params: {
  startDate: string
  endDate: string
  role?: import('../types/roles').UserRole
  username?: string
}): Promise<number> {
  const scoped = await getBoardScopedViewsForRange({ ...params, preset: 'custom' })
  const withRaw = attachRawByMatchToViews(scoped.views, scoped.rawByMatch)
  const remapped = await remapViewsWithScheduleOverlay(withRaw)
  const deduped = dedupeViewsByMetricOrderNo(remapped)
  return deduped.length
}

export async function getAnchorAuditExportMeta(params?: {
  startDate?: string
  endDate?: string
}): Promise<{
  earliestOrderDate: string | null
  today: string
  defaultStartDate: string | null
  defaultEndDate: string
  orderCountInRange: number
  afterSalesPendingCount: number
}> {
  const earliest = await getEarliestOrderDateKey()
  const today = formatDateKeyShanghai(new Date())
  const startDate = params?.startDate ?? earliest ?? today
  const endDate = params?.endDate ?? today

  const [orderCount, pocket] = await Promise.all([
    countAnchorAuditExportOrders({ startDate, endDate }),
    buildAnchorPocketSummary({
      startDate,
      endDate,
      preset: 'custom',
    }),
  ])
  const afterSalesPendingCount =
    pocket.dataQualityWarnings.find((w) => w.type === 'after_sales_pending')?.count ?? 0

  return {
    earliestOrderDate: earliest,
    today,
    defaultStartDate: earliest,
    defaultEndDate: today,
    orderCountInRange: orderCount,
    afterSalesPendingCount,
  }
}

const SOURCE_LABEL: Record<ScheduleAttributionSource, string> = {
  manual_schedule: '手动排班',
  default_schedule: '默认排班',
  saved_time_rule: '时段规则',
  template_virtual: '模板虚拟',
  legacy_rule: '旧规则',
  unmatched: '未归属',
}

export async function buildAnchorAuditExportPayload(params: {
  startDate: string
  endDate: string
  role?: import('../types/roles').UserRole
  username?: string
}) {
  const scoped = await getBoardScopedViewsForRange(params)
  const withRaw = attachRawByMatchToViews(scoped.views, scoped.rawByMatch)
  const remapped = await remapViewsWithScheduleOverlay(withRaw)
  const deduped = dedupeViewsByMetricOrderNo(remapped)

  await bootstrapWorkbenchCache()
  const queries = buildLiveAccountOrderQueries(deduped)
  const bundle = await buildRawAnalyzeBundle(scoped.range)
  const fromDb = await loadWorkbenchRefundMapFromDb(queries)
  const fromMem = bundle ? getWorkbenchRefundMapForOrders(queries) : new Map()
  const workbenchByAccountOrder = mergeWorkbenchRefundMaps(fromDb, fromMem)

  const pocketSummary = await buildAnchorPocketSummary(params)
  const unconfirmedDates = await listUnconfirmedScheduleDatesInRange(
    params.startDate,
    params.endDate,
  )
  const cookieStatus = await getShopCookieStatusPayload()

  const scheduleRows = await prisma.anchorDailySchedule.findMany({
    where: {
      scheduleDate: { gte: params.startDate, lte: params.endDate },
    },
    orderBy: [{ scheduleDate: 'asc' }, { startAt: 'asc' }],
  })

  const afterSalesRows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    where: {
      updatedAt: {
        gte: new Date(`${params.startDate}T00:00:00+08:00`),
      },
    },
    take: 50000,
  })

  const normalizedOrders: Array<Record<string, unknown>> = []
  const warnings: Array<Record<string, unknown>> = []
  const orderNoSeen = new Map<string, number>()

  for (const view of deduped) {
    const orderNo = resolveMetricOrderNo(view) || view.displayOrderNo || view.orderId
    const workbench = lookupWorkbenchRefund(
      workbenchByAccountOrder,
      view.liveAccountId,
      orderNo,
    )
    const meta = ANCHOR_SESSION_DISPLAY_FROM_0613[view.anchorName ?? ''] ?? {
      shopName: view.liveAccountName ?? '—',
      sessionLabel: '—',
    }
    const line = classifyAnchorPocketOrder({
      view,
      shopName: meta.shopName,
      sessionName: meta.sessionLabel,
      workbench,
    })
    const attr = await resolveAnchorWithScheduleOverlay(view)
    const payMs = parseViewPayTimeMs(view)
    const payTime =
      payMs != null
        ? new Date(payMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
        : view.orderTimeText ?? ''

    if (orderNo) {
      orderNoSeen.set(orderNo, (orderNoSeen.get(orderNo) ?? 0) + 1)
    }

    normalizedOrders.push({
      orderNo,
      liveAccountName: view.liveAccountName ?? '',
      payTime,
      orderStatus: view.orderStatusText ?? '',
      afterSaleStatus: view.afterSaleStatusText ?? '',
      paidAmount: centToYuan(view.paymentBaseCent ?? 0),
      isBrush: line?.isBrushOrder ?? isBrushOrderPaidCent(view.paymentBaseCent ?? 0),
      anchorName: attr.anchorName,
      attributionSource: attr.attributionSource,
      attributionSourceLabel: SOURCE_LABEL[attr.attributionSource],
      attributionExplain: attr.attributionExplain,
      scheduleConfirmed: attr.scheduleConfirmed,
      isClosedOrCanceled: line?.isClosedOrCanceled ?? isClosedOrCanceledOrderView(view),
      isPendingReceive: line?.isPendingReceive ?? isPendingReceiveOrderView(view),
      isRefundProcessing: line?.isRefundProcessing ?? isRefundProcessingOrderView(view, workbench),
      refundFinishedAmount: centToYuan(line?.refundFinishedAmountCent ?? 0),
      actualPocketAmount: centToYuan(line?.actualPocketAmountCent ?? 0),
      afterSalesDataPending: line?.afterSalesDataPending ?? false,
    })

    if (attr.anchorName === '未归属') {
      warnings.push({
        type: 'unmatched_anchor',
        orderNo,
        liveAccountName: view.liveAccountName,
        payTime,
        amount: centToYuan(view.paymentBaseCent ?? 0),
        issue: '未匹配主播',
        suggestion: '检查当天排班或订单支付时间',
      })
    }
    if (line?.afterSalesDataPending) {
      warnings.push({
        type: 'after_sales_pending',
        orderNo,
        liveAccountName: view.liveAccountName,
        payTime,
        amount: centToYuan(view.paymentBaseCent ?? 0),
        issue: '售后数据未确认',
        suggestion: '补拉售后工作台后再导出',
      })
    }
    if (workbench?.fetchStatus === 'failed') {
      warnings.push({
        type: 'after_sales_failed',
        orderNo,
        issue: '售后拉取失败',
        suggestion: workbench.fetchError ?? '重新同步售后',
      })
    }
    if ((line?.refundFinishedAmountCent ?? 0) > (line?.paidAmountCent ?? 0)) {
      warnings.push({
        type: 'refund_exceeds_paid',
        orderNo,
        issue: '退款金额超过订单金额',
        suggestion: '人工核对售后明细',
      })
    }
    if (!attr.scheduleConfirmed && attr.attributionSource !== 'legacy_rule') {
      warnings.push({
        type: 'schedule_unconfirmed',
        orderNo,
        payTime,
        issue: '排班未确认',
        suggestion: '请在每日排班页确认后再核算',
      })
    }
  }

  for (const [orderNo, count] of orderNoSeen) {
    if (count > 1) {
      warnings.push({
        type: 'duplicate_order_no',
        orderNo,
        issue: `订单号重复 ${count} 次`,
        suggestion: '检查去重逻辑',
      })
    }
  }

  for (const d of unconfirmedDates) {
    warnings.push({
      type: 'schedule_date_unconfirmed',
      date: d,
      issue: `${d} 排班未确认`,
      suggestion: '确认今日/昨日排班',
    })
  }

  for (const shop of cookieStatus.shops) {
    if (!shop.hasCookie) {
      warnings.push({
        type: 'cookie_missing',
        shopName: shop.shopName,
        issue: '未收到 Cookie',
        suggestion: '由千帆机器人上传 Cookie',
      })
    }
  }

  const afterSales = afterSalesRows.map((r) => ({
    orderNo: r.orderNo,
    liveAccountId: r.liveAccountId,
    fetchStatus: r.fetchStatus,
    afterSaleStatus: r.afterSaleStatus ?? '',
    officialRefundAmount: centToYuan(r.officialRefundAmountCent ?? 0),
    settlementAmount: r.settlementAmountCent != null ? centToYuan(r.settlementAmountCent) : null,
    fetchedAt: r.fetchedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
    matchedOrder: Boolean(orderNoSeen.has(r.orderNo)),
    fetchError: r.fetchError,
  }))

  const schedules = scheduleRows.map((r) => ({
    scheduleDate: r.scheduleDate,
    anchorName: r.anchorName,
    shopName: r.shopName,
    liveRoomName: r.liveRoomName,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    source: r.source,
    confirmed: r.confirmed,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))

  return {
    range: { startDate: params.startDate, endDate: params.endDate },
    exportedAt: new Date().toISOString(),
    summaryByAnchor: pocketSummary.anchors,
    normalizedOrders,
    afterSales,
    schedules,
    warnings,
    meta: {
      orderCount: normalizedOrders.length,
      unconfirmedScheduleDates: unconfirmedDates,
      earliestOrderDate: await getEarliestOrderDateKey(),
    },
  }
}

export async function buildAnchorAuditExcelBuffer(params: {
  startDate: string
  endDate: string
  role?: import('../types/roles').UserRole
  username?: string
}): Promise<{ buffer: Buffer; filename: string }> {
  const payload = await buildAnchorAuditExportPayload(params)
  const wb = new ExcelJS.Workbook()

  addTableSheet(wb, '主播汇总', [
    '主播',
    '店铺/直播间',
    '场次',
    '业绩内金额',
    '已退款金额',
    '售后处理中',
    '未签收待确认',
    '实际到账金额',
    '刷单金额',
    '退款率',
    '订单数',
    '说明',
  ], payload.summaryByAnchor.map((a) => [
    a.anchorName,
    a.shopName,
    a.sessionName,
    a.performanceAmount,
    a.refundFinishedAmount,
    a.refundProcessingAmount,
    a.pendingReceiveAmount,
    a.actualPocketAmount,
    a.brushAmount,
    a.refundRate ?? '',
    a.detail?.performanceOrderCount ?? '',
    a.explainText,
  ]))

  addTableSheet(wb, '订单明细', [
    '订单号',
    '店铺/直播间',
    '支付时间',
    '订单状态',
    '售后状态',
    '支付金额',
    '是否刷单',
    '匹配主播',
    '匹配来源',
    '匹配说明',
    '排班已确认',
    '是否关闭/取消',
    '未签收待确认',
    '售后处理中',
    '已完成退款',
    '实际到账',
  ], payload.normalizedOrders.map((o) => [
    o.orderNo,
    o.liveAccountName,
    o.payTime,
    o.orderStatus,
    o.afterSaleStatus,
    o.paidAmount,
    o.isBrush ? '是' : '否',
    o.anchorName,
    o.attributionSourceLabel,
    o.attributionExplain,
    o.scheduleConfirmed ? '是' : '否',
    o.isClosedOrCanceled ? '是' : '否',
    o.isPendingReceive ? '是' : '否',
    o.isRefundProcessing ? '是' : '否',
    o.refundFinishedAmount,
    o.actualPocketAmount,
  ]))

  addTableSheet(wb, '售后明细', [
    '订单号',
    '直播号ID',
    '售后状态',
    '拉取状态',
    '退款金额',
    '结算金额',
    '拉取时间',
    '更新时间',
    '已匹配订单',
    '错误信息',
  ], payload.afterSales.map((a) => [
    a.orderNo,
    a.liveAccountId,
    a.afterSaleStatus,
    a.fetchStatus,
    a.officialRefundAmount,
    a.settlementAmount ?? '',
    a.fetchedAt ?? '',
    a.updatedAt,
    a.matchedOrder ? '是' : '否',
    a.fetchError ?? '',
  ]))

  addTableSheet(wb, '排班明细', [
    '日期',
    '主播',
    '店铺/直播间',
    '开始时间',
    '结束时间',
    '来源',
    '已确认',
    '备注',
    '创建时间',
    '更新时间',
  ], payload.schedules.map((s) => [
    s.scheduleDate,
    s.anchorName,
    s.liveRoomName,
    s.startAt,
    s.endAt,
    s.source === 'manual' ? '手动' : '默认',
    s.confirmed ? '是' : '否',
    s.note ?? '',
    s.createdAt,
    s.updatedAt,
  ]))

  addTableSheet(wb, '异常待确认', [
    '类型',
    '订单号',
    '店铺/直播间',
    '支付时间',
    '金额',
    '当前问题',
    '建议处理',
  ], payload.warnings.map((w) => [
    w.type,
    w.orderNo ?? w.date ?? w.shopName ?? '',
    w.liveAccountName ?? '',
    w.payTime ?? '',
    w.amount ?? '',
    w.issue,
    w.suggestion,
  ]))

  const buf = await wb.xlsx.writeBuffer()
  return {
    buffer: Buffer.from(buf),
    filename: `核算导出_${params.startDate}_${params.endDate}.xlsx`,
  }
}
