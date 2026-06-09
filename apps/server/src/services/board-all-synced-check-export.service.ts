import ExcelJS from 'exceljs'
import { prisma } from '../lib/prisma'
import {
  AMOUNT_FORMULA_VERSION,
  GMV_PAYMENT_FIELD_NOTE,
} from './order-amount-metrics.service'
import {
  BUSINESS_METRICS_VERSION,
  calculateBusinessMetrics,
  isQualityRefundOrder,
} from './business-metrics.service'
import { aggregateAnchorLeaderboard } from './board-metrics.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { buildRawAnalyzeBundleAll } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { getBuyerRankingProfile } from './buyer-ranking-cache.service'
import type { BuyerRankingItem } from './buyer-ranking.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import { pickPaymentTimeText, hasPaymentTimeText } from '../utils/order-payment-time.util'
import type { NormalizedOrder } from '../types/analysis'
import {
  attachRawByMatchToViews,
  filterViewsForAnchorPerformance,
  isLowPriceBrushOrderView,
  LOW_PRICE_BRUSH_THRESHOLD_CENT,
  resolveLowPriceBrushDebugFields,
} from './low-price-brush-order.service'
import {
  getLiveAccountRowMapperContext,
  resolveLiveAccountDisplayName,
} from './live-account.service'
import { loadAllQualityBadCases } from './quality-badcase-store.service'
import { matchStatusLabel } from './quality-badcase.types'
import { getBusinessSyncStatus } from './business-sync-scheduler.service'
import { isSuccessfulAfterSale } from './strict-after-sale-metrics.service'
import {
  buildOrderMap,
  getMasterOrderNos,
  matchAfterSaleRawToMaster,
  normalizeOrderIdentifier,
} from './order-master-match.service'
import {
  resolveAppliedAfterSaleAmountCent,
  resolveBusinessAfterSale,
  resolveUserPaidAmountCent,
} from './business-refund-caliber.service'
import { viewCountsAsRefundOrder } from './order-refund-metrics.service'
import {
  normalizeLiveSessionsFromRaw,
  type NormalizedLiveSession,
} from './xhs-api-sync/xhs-json-normalizer.service'
import { mapViewToBoardOrderRow } from './order-row-mapper.service'
import { centToYuan, formatRate } from '../utils/money'
import { formatDateTime } from '../utils/time'
import type { AnalyzedOrderView } from '../types/analysis'

export interface BoardAllSyncedCheckExportMeta {
  startTime: string | null
  endTime: string | null
  orderCount: number
  /** 售后工作台缓存行数（按订单号一条） */
  afterSaleCount: number
  rawAfterSaleCacheRowCount: number
  /** rawDetail 展开后的售后记录条数 */
  rawAfterSaleRecordCount: number
  /** 售后原始明细 Sheet 行数 */
  exportedAfterSaleCount: number
  /** 售后明细 Sheet 行数（已匹配订单主表） */
  matchedAfterSaleCount: number
  /** @deprecated 使用 successfulAfterSaleCount */
  effectiveSuccessAfterSaleCount: number
  successfulAfterSaleCount: number
  businessRefundAfterSaleCount: number
  freightOnlyRefundCount: number
  businessRefundAmountCent: number
  qualityIssueCount: number
  liveSessionCount: number
  rawLiveSessionCount: number
  exportedLiveSessionCount: number
  lastSyncedAt: string | null
}

interface AfterSaleCacheExportRow {
  liveAccountId: string
  orderNo: string
  packageId: string | null
  afterSaleReason: string | null
  afterSaleStatus: string | null
  officialRefundAmountCent: number
  successReturnCount: number
  returnsIds: string | null
  rawDetail: unknown
}

interface AfterSaleStats {
  cacheRows: AfterSaleCacheExportRow[]
  rawAfterSaleCacheRowCount: number
  rawAfterSaleRecordCount: number
  effectiveSuccessAfterSaleCount: number
  successfulAfterSaleCount: number
  businessRefundAfterSaleCount: number
  freightOnlyRefundCount: number
  businessRefundAmountCent: number
  rawOriginalRows: unknown[][]
  matchedRows: unknown[][]
  matchedAfterSaleCount: number
}

function styleHeader(sheet: ExcelJS.Worksheet, cols: number): void {
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (cols > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } }
  }
}

function addKvSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: Array<[string, string | number]>,
): void {
  const sheet = wb.addWorksheet(name)
  sheet.columns = [{ width: 36 }, { width: 72 }]
  sheet.addRow(['字段', '值'])
  for (const [k, v] of rows) sheet.addRow([k, v])
  styleHeader(sheet, 2)
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

function s(v: unknown): string {
  if (v == null || v === '') return '—'
  return String(v)
}

function yesNo(v: unknown): string {
  return v === true || v === 'true' || v === 1 ? '是' : '否'
}

function formatTs(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
}

function pickPaymentTime(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
  orderByMatchId?: Map<string, NormalizedOrder>,
): string {
  const order = orderByMatchId?.get(v.matchOrderId || v.orderId)
  return pickPaymentTimeText(v, order)
}

function hasPaymentTime(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
  orderByMatchId?: Map<string, NormalizedOrder>,
): boolean {
  return hasPaymentTimeText(v, orderByMatchId?.get(v.matchOrderId || v.orderId))
}

/** 统计口径支付金额：无支付时间为 0；有支付时间保留实际支付基数（与经营总览一致） */
function statPaymentYuan(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
  row: ReturnType<typeof mapViewToBoardOrderRow>,
  orderByMatchId?: Map<string, NormalizedOrder>,
): number {
  if (!hasPaymentTime(v, orderByMatchId)) return 0
  if (row.paymentBaseAmount > 0) return row.paymentBaseAmount
  return centToYuan(v.paymentBaseCent || 0)
}

function pickUnitPriceYuan(v: AnalyzedOrderView & { raw?: Record<string, unknown> }): number {
  const { unitPriceCentForBrushCheck } = resolveLowPriceBrushDebugFields(v)
  return centToYuan(unitPriceCentForBrushCheck)
}

function statusNote(v: AnalyzedOrderView): string {
  const parts: string[] = []
  if (v.gmvExcludeReason) parts.push(v.gmvExcludeReason)
  if (v.matchedRuleName) parts.push(`归属规则：${v.matchedRuleName}`)
  return parts.join('；') || '—'
}

function pickLiveRawField(raw: Record<string, unknown>, fieldName: string): string {
  const field = raw[fieldName]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    if (f.value != null && String(f.value).trim()) return String(f.value).trim()
    if (f.displayValue != null && String(f.displayValue).trim()) return String(f.displayValue).trim()
  }
  return raw[fieldName] != null ? String(raw[fieldName]).trim() : '—'
}

function pickLiveRawCount(raw: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = pickLiveRawField(raw, k)
    if (v === '—') continue
    const n = Number(String(v).replace(/,/g, ''))
    if (Number.isFinite(n)) return Math.round(n)
  }
  return 0
}

function afterSaleStatusText(raw: Record<string, unknown>): string {
  return s(
    raw.status_name ??
      raw.statusName ??
      raw.refund_status_name ??
      raw.refundStatusName ??
      raw.afterSaleStatus,
  )
}

function afterSaleReasonText(raw: Record<string, unknown>): string {
  return s(raw.reason_name_zh ?? raw.reasonNameZh ?? raw.reason ?? raw.afterSaleReason)
}

function afterSaleTypeText(raw: Record<string, unknown>): string {
  return s(raw.return_type_name ?? raw.returnTypeName ?? raw.afterSaleType)
}

function afterSaleStatusNote(
  raw: Record<string, unknown>,
  resolved: ReturnType<typeof resolveBusinessAfterSale>,
  match: ReturnType<typeof matchAfterSaleRawToMaster>,
): string {
  if (!match.matched) return match.reason ?? '售后记录未匹配到订单主表'
  if (resolved.isFreightOnly) return '纯 18 元运费退款，不计入退款金额与退款订单'
  if (!isSuccessfulAfterSale(raw)) return '非成功售后（待处理/已取消/已关闭等），不计入业务退款'
  if (resolved.isBusinessRefund) return '成功售后，计入业务退款'
  return '—'
}

function buildAfterSaleDetailRow(
  raw: Record<string, unknown>,
  masterOrderNos: Set<string>,
  fallbackOrderNo?: string,
): unknown[] {
  const successful = isSuccessfulAfterSale(raw)
  const resolved = resolveBusinessAfterSale(raw, { isSuccessful: successful })
  const match = matchAfterSaleRawToMaster(raw, masterOrderNos, fallbackOrderNo)
  const orderNo =
    match.matchedOrderNo ??
    normalizeOrderIdentifier(raw.package_id ?? raw.packageId ?? fallbackOrderNo)

  return [
    s(raw.returns_id ?? raw.returnsId ?? raw.afterSaleId),
    orderNo || '—',
    s(raw.buyer_nickname ?? raw.buyerNickname ?? raw.nick_name ?? raw.nickName),
    s(raw.buyer_id ?? raw.buyerId ?? raw.user_id ?? raw.userId),
    centToYuan(resolveUserPaidAmountCent(raw)),
    centToYuan(resolveAppliedAfterSaleAmountCent(raw)),
    centToYuan(resolved.businessRefundAmountCent),
    yesNo(resolved.isFreightOnly),
    yesNo(resolved.isBusinessRefund),
    match.matched ? '是' : '否',
    match.matchedOrderNo ?? '—',
    afterSaleStatusText(raw),
    afterSaleReasonText(raw),
    afterSaleStatusNote(raw, resolved, match),
    afterSaleTypeText(raw),
    s(raw.time ?? raw.applyTime ?? raw.createdAt),
    s(raw.finish_time ?? raw.finishTime ?? raw.completedAt ?? raw.refund_ok_time),
  ]
}

function buildAfterSaleRawOriginalRow(
  raw: Record<string, unknown>,
  ctx: {
    liveAccountId: string
    orderNo: string
    packageId: string | null
    workbenchStatus: string | null
    workbenchReason: string | null
    workbenchRefundCent: number
    successReturnCount: number
    returnsIds: string | null
  },
  masterOrderNos: Set<string>,
): unknown[] {
  const match = matchAfterSaleRawToMaster(raw, masterOrderNos, ctx.orderNo)
  const successful = isSuccessfulAfterSale(raw)
  const resolved = resolveBusinessAfterSale(raw, { isSuccessful: successful })
  const base = buildAfterSaleDetailRow(raw, masterOrderNos, ctx.orderNo)
  return [
    ctx.liveAccountId,
    ctx.orderNo,
    ctx.packageId ?? '—',
    ...base,
    ctx.workbenchStatus ?? '—',
    ctx.workbenchReason ?? '—',
    centToYuan(ctx.workbenchRefundCent),
    centToYuan(resolved.businessRefundAmountCent),
    ctx.successReturnCount,
    ctx.returnsIds ?? '—',
  ]
}

async function loadAfterSaleExportStats(
  masterOrderNos: Set<string>,
  bundleRawMap: Map<string, Record<string, unknown>[]>,
): Promise<AfterSaleStats> {
  const cacheRows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    select: {
      liveAccountId: true,
      orderNo: true,
      packageId: true,
      afterSaleReason: true,
      afterSaleStatus: true,
      officialRefundAmountCent: true,
      successReturnCount: true,
      returnsIds: true,
      rawDetail: true,
    },
  })

  let rawAfterSaleRecordCount = 0
  let effectiveSuccessAfterSaleCount = 0
  let successfulAfterSaleCount = 0
  let businessRefundAfterSaleCount = 0
  let freightOnlyRefundCount = 0
  let businessRefundAmountCent = 0
  const rawOriginalRows: unknown[][] = []
  const matchedRows: unknown[][] = []
  const seenReturnIds = new Set<string>()

  const trackRecord = (raw: Record<string, unknown>): void => {
    const rid = s(raw.returns_id ?? raw.returnsId ?? raw.afterSaleId)
    const dedupeKey = rid !== '—' ? rid : JSON.stringify(raw)
    if (seenReturnIds.has(dedupeKey)) return
    seenReturnIds.add(dedupeKey)

    rawAfterSaleRecordCount += 1
    const successful = isSuccessfulAfterSale(raw)
    if (successful) {
      effectiveSuccessAfterSaleCount += 1
      successfulAfterSaleCount += 1
    }
    const resolved = resolveBusinessAfterSale(raw, { isSuccessful: successful })
    if (resolved.isFreightOnly) freightOnlyRefundCount += 1
    if (resolved.isBusinessRefund) {
      businessRefundAfterSaleCount += 1
      businessRefundAmountCent += resolved.businessRefundAmountCent
    }
    const match = matchAfterSaleRawToMaster(raw, masterOrderNos)
    if (match.matched) {
      matchedRows.push(buildAfterSaleDetailRow(raw, masterOrderNos))
    }
  }

  for (const row of cacheRows) {
    const detail = row.rawDetail
    if (Array.isArray(detail) && detail.length > 0) {
      for (const item of detail) {
        if (!item || typeof item !== 'object') continue
        const raw = item as Record<string, unknown>
        rawOriginalRows.push(
          buildAfterSaleRawOriginalRow(raw, {
            liveAccountId: row.liveAccountId,
            orderNo: row.orderNo,
            packageId: row.packageId,
            workbenchStatus: row.afterSaleStatus,
            workbenchReason: row.afterSaleReason,
            workbenchRefundCent: row.officialRefundAmountCent,
            successReturnCount: row.successReturnCount,
            returnsIds: row.returnsIds,
          }, masterOrderNos),
        )
        trackRecord(raw)
      }
    } else {
      rawAfterSaleRecordCount += 1
      rawOriginalRows.push([
        row.liveAccountId,
        row.orderNo,
        row.packageId ?? '—',
        row.returnsIds ?? '—',
        row.packageId ?? row.orderNo,
        '—',
        '—',
        centToYuan(row.officialRefundAmountCent),
        0,
        0,
        0,
        '否',
        '否',
        matchAfterSaleRawToMaster({}, masterOrderNos, row.orderNo).matched ? '是' : '否',
        '—',
        row.afterSaleStatus ?? '—',
        row.afterSaleReason ?? '—',
        '售后工作台有缓存但无 rawDetail 明细',
        '—',
        '—',
        '—',
        row.afterSaleStatus ?? '—',
        row.afterSaleReason ?? '—',
        centToYuan(row.officialRefundAmountCent),
        0,
        row.successReturnCount,
        row.returnsIds ?? '—',
      ])
    }
  }

  for (const [orderNo, list] of bundleRawMap) {
    for (const raw of list) {
      trackRecord(raw)
    }
  }

  return {
    cacheRows,
    rawAfterSaleCacheRowCount: cacheRows.length,
    rawAfterSaleRecordCount,
    effectiveSuccessAfterSaleCount,
    successfulAfterSaleCount,
    businessRefundAfterSaleCount,
    freightOnlyRefundCount,
    businessRefundAmountCent,
    rawOriginalRows,
    matchedRows,
    matchedAfterSaleCount: matchedRows.length,
  }
}

function buildLiveSessionMatchSummary(
  sessions: NormalizedLiveSession[],
  liveAccountBySessionId: Map<string, string>,
  views: Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>,
): unknown[][] {
  type Summary = {
    liveAccount: string
    anchor: string
    sessionCount: number
    orderCount: number
    payCent: number
    unassignedOrderCount: number
    unassignedPayCent: number
  }

  const byKey = new Map<string, Summary>()
  const ensure = (liveAccount: string, anchor: string): Summary => {
    const key = `${liveAccount}::${anchor}`
    const cur = byKey.get(key) ?? {
      liveAccount,
      anchor,
      sessionCount: 0,
      orderCount: 0,
      payCent: 0,
      unassignedOrderCount: 0,
      unassignedPayCent: 0,
    }
    byKey.set(key, cur)
    return cur
  }

  const viewsByStart = new Map<string, Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>>()
  for (const v of views) {
    if (!v.matchedLiveStartTime) continue
    const list = viewsByStart.get(v.matchedLiveStartTime) ?? []
    list.push(v)
    viewsByStart.set(v.matchedLiveStartTime, list)
  }

  for (const session of sessions) {
    const liveAccount =
      liveAccountBySessionId.get(session.id) ||
      pickLiveRawField(session.raw, 'liveAccountName') ||
      '—'
    const startText = session.startTime ? formatDateTime(session.startTime) : '—'
    const matchedViews = viewsByStart.get(startText) ?? []
    const anchor = matchedViews[0]?.anchorName?.trim() || session.anchorName || '未归属'
    const row = ensure(liveAccount, anchor)
    row.sessionCount += 1
  }

  for (const v of views) {
    const ctx = getLiveAccountRowMapperContext()
    const resolved = resolveLiveAccountDisplayName(v.liveAccountId, v.liveAccountName, ctx)
    const liveAccount = resolved.liveAccountName || '—'
    const anchor = v.anchorName?.trim() || '未归属'
    const row = ensure(liveAccount, anchor)
    row.orderCount += 1
    const payCent = v.includedInGmv ? v.paymentBaseCent || 0 : 0
    if (anchor === '未归属') {
      row.unassignedOrderCount += 1
      row.unassignedPayCent += payCent
    } else {
      row.payCent += payCent
    }
  }

  return [...byKey.values()]
    .sort((a, b) => a.liveAccount.localeCompare(b.liveAccount) || a.anchor.localeCompare(b.anchor))
    .map((row) => [
      row.liveAccount,
      row.anchor,
      row.sessionCount,
      row.orderCount,
      centToYuan(row.payCent),
      row.unassignedOrderCount,
      centToYuan(row.unassignedPayCent),
    ])
}

function buildLiveSessionRawRows(
  sessions: NormalizedLiveSession[],
  liveAccountBySessionId: Map<string, string>,
  liveAccountIdBySessionId: Map<string, string>,
  views: Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>,
): unknown[][] {
  const viewsByStart = new Map<string, Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>>()
  for (const v of views) {
    if (!v.matchedLiveStartTime) continue
    const list = viewsByStart.get(v.matchedLiveStartTime) ?? []
    list.push(v)
    viewsByStart.set(v.matchedLiveStartTime, list)
  }

  return sessions.map((session) => {
    const raw = session.raw
    const liveAccount =
      liveAccountBySessionId.get(session.id) ||
      pickLiveRawField(raw, 'liveAccountName') ||
      '—'
    const liveAccountId = liveAccountIdBySessionId.get(session.id) || '—'
    const startText = session.startTime ? formatDateTime(session.startTime) : '—'
    const endText = session.endTime ? formatDateTime(session.endTime) : '—'
    const matchedViews = viewsByStart.get(startText) ?? []
    const matchedAnchor = matchedViews[0]?.anchorName?.trim() || '—'
    const matchedRule =
      matchedViews[0]?.matchedRuleName?.trim() ||
      matchedViews[0]?.attributionType ||
      '—'
    const matched = matchedAnchor !== '—' && matchedAnchor !== '未归属'

    return [
      session.liveId || session.id,
      session.liveName || pickLiveRawField(raw, 'liveName'),
      liveAccount,
      session.anchorName || pickLiveRawField(raw, 'nickName'),
      pickLiveRawField(raw, 'userId') || pickLiveRawField(raw, 'xhsId') || liveAccountId,
      startText,
      endText,
      session.durationMinutes,
      pickLiveRawCount(raw, 'joinUserNum', 'viewerNum', 'liveViewUserNum', 'watchUserNum'),
      pickLiveRawCount(raw, 'watchNum', 'liveViewNum', 'viewCnt'),
      pickLiveRawCount(raw, 'exposeUserNum', 'exposeNum', 'liveExposeUserNum'),
      pickLiveRawCount(raw, 'goodsExposeUserNum', 'itemExposeUserNum', 'goodsViewUserNum'),
      session.dealOrderCount || pickLiveRawCount(raw, 'dealOrderCnt'),
      centToYuan(session.liveGmvCent || 0),
      matched ? '是' : '否',
      matched ? matchedAnchor : '—',
      matched ? matchedRule : '—',
    ]
  })
}

async function loadAfterSaleMetaCounts(): Promise<{
  rawAfterSaleCacheRowCount: number
  rawAfterSaleRecordCount: number
  effectiveSuccessAfterSaleCount: number
  successfulAfterSaleCount: number
  businessRefundAfterSaleCount: number
  freightOnlyRefundCount: number
  businessRefundAmountCent: number
}> {
  const cacheRows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    select: { rawDetail: true },
  })
  let rawAfterSaleRecordCount = 0
  let effectiveSuccessAfterSaleCount = 0
  let successfulAfterSaleCount = 0
  let businessRefundAfterSaleCount = 0
  let freightOnlyRefundCount = 0
  let businessRefundAmountCent = 0
  for (const row of cacheRows) {
    const detail = row.rawDetail
    if (Array.isArray(detail) && detail.length > 0) {
      for (const item of detail) {
        if (!item || typeof item !== 'object') continue
        const raw = item as Record<string, unknown>
        rawAfterSaleRecordCount += 1
        const successful = isSuccessfulAfterSale(raw)
        if (successful) {
          effectiveSuccessAfterSaleCount += 1
          successfulAfterSaleCount += 1
        }
        const resolved = resolveBusinessAfterSale(raw, { isSuccessful: successful })
        if (resolved.isFreightOnly) freightOnlyRefundCount += 1
        if (resolved.isBusinessRefund) {
          businessRefundAfterSaleCount += 1
          businessRefundAmountCent += resolved.businessRefundAmountCent
        }
      }
    } else {
      rawAfterSaleRecordCount += 1
    }
  }
  return {
    rawAfterSaleCacheRowCount: cacheRows.length,
    rawAfterSaleRecordCount,
    effectiveSuccessAfterSaleCount,
    successfulAfterSaleCount,
    businessRefundAfterSaleCount,
    freightOnlyRefundCount,
    businessRefundAmountCent,
  }
}

export async function buildBoardAllSyncedCheckExportMeta(): Promise<BoardAllSyncedCheckExportMeta> {
  const [orderAgg, liveSessionCount, qualityIssueCount, afterSaleStats, syncStatus] =
    await Promise.all([
      prisma.xhsRawOrder.aggregate({
        _count: true,
        _min: { orderTime: true },
        _max: { orderTime: true },
      }),
      prisma.xhsRawLiveSession.count(),
      prisma.qualityBadCase.count(),
      loadAfterSaleMetaCounts(),
      getBusinessSyncStatus(),
    ])

  const rawAfterSaleCacheRowCount = afterSaleStats.rawAfterSaleCacheRowCount

  return {
    startTime: orderAgg._min.orderTime ? formatDateTime(orderAgg._min.orderTime) : null,
    endTime: orderAgg._max.orderTime ? formatDateTime(orderAgg._max.orderTime) : null,
    orderCount: orderAgg._count,
    afterSaleCount: rawAfterSaleCacheRowCount,
    rawAfterSaleCacheRowCount,
    rawAfterSaleRecordCount: afterSaleStats.rawAfterSaleRecordCount,
    exportedAfterSaleCount: afterSaleStats.rawAfterSaleRecordCount,
    matchedAfterSaleCount: 0,
    effectiveSuccessAfterSaleCount: afterSaleStats.effectiveSuccessAfterSaleCount,
    successfulAfterSaleCount: afterSaleStats.successfulAfterSaleCount,
    businessRefundAfterSaleCount: afterSaleStats.businessRefundAfterSaleCount,
    freightOnlyRefundCount: afterSaleStats.freightOnlyRefundCount,
    businessRefundAmountCent: afterSaleStats.businessRefundAmountCent,
    qualityIssueCount,
    liveSessionCount,
    rawLiveSessionCount: liveSessionCount,
    exportedLiveSessionCount: liveSessionCount,
    lastSyncedAt: syncStatus.businessSync.lastSuccessAt,
  }
}

async function loadAllSyncedAnalysis() {
  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle || bundle.orders.length === 0) {
    throw new Error('本地无已同步数据，请先完成经营数据同步后再导出核对包')
  }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts.dedupe.uniqueOrders) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const viewsWithRaw = attachRawByMatchToViews(artifacts.views, rawByMatch)
  return { bundle, artifacts, viewsWithRaw }
}

export async function buildBoardAllSyncedCheckExportBuffer(params: {
  username?: string
}): Promise<{ buffer: Buffer; filename: string }> {
  const { bundle, artifacts, viewsWithRaw } = await loadAllSyncedAnalysis()
  const liveAccountCtx = getLiveAccountRowMapperContext()
  const orderByMatchId = new Map(
    artifacts.dedupe.uniqueOrders.map((o) => [o.matchOrderId, o] as const),
  )
  const coreViewsWithRaw = filterViewsForCoreMetrics(viewsWithRaw)
  const metrics = calculateBusinessMetrics(coreViewsWithRaw)
  const anchorViews = filterViewsForAnchorPerformance(coreViewsWithRaw)
  const anchors = aggregateAnchorLeaderboard(anchorViews)
  const buyerProfile = await getBuyerRankingProfile()
  const qualityCases = await loadAllQualityBadCases()
  const normalizedLiveSessions = await normalizeLiveSessionsFromRaw()
  const liveDbRows = await prisma.xhsRawLiveSession.findMany({
    select: { id: true, liveAccountId: true, liveAccountName: true },
  })
  const liveAccountBySessionId = new Map(
    liveDbRows.map((r) => [r.id, r.liveAccountName?.trim() || r.liveAccountId || '—']),
  )
  const liveAccountIdBySessionId = new Map(liveDbRows.map((r) => [r.id, r.liveAccountId]))

  const orderMap = buildOrderMap(artifacts.dedupe.uniqueOrders)
  const masterOrderNos = getMasterOrderNos(orderMap)
  const bundleRawMap = bundle.rawAfterSalesByOrderNo ?? new Map<string, Record<string, unknown>[]>()
  const afterSaleStats = await loadAfterSaleExportStats(masterOrderNos, bundleRawMap)

  const exportedOrderCount = viewsWithRaw.length
  const paidOrderCount = metrics.orderCount
  const paidAmount = metrics.totalGmv

  const now = new Date()
  const ts = formatTs(now)
  const orderAgg = await prisma.xhsRawOrder.aggregate({
    _min: { orderTime: true },
    _max: { orderTime: true },
  })
  const syncedRangeLabel =
    orderAgg._min.orderTime && orderAgg._max.orderTime
      ? `${formatDateTime(orderAgg._min.orderTime)} ~ ${formatDateTime(orderAgg._max.orderTime)}`
      : '—'

  const wb = new ExcelJS.Workbook()

  addKvSheet(wb, '核对说明', [
    ['导出时间', now.toISOString()],
    ['导出模式', '全部已同步数据'],
    ['系统已同步数据范围', syncedRangeLabel],
    ['系统订单总数（本地 raw 行）', artifacts.dedupe.uniqueOrders.length],
    ['官方订单去重后订单数（说明）', '应与系统导出订单明细行数一致'],
    ['系统导出订单数', exportedOrderCount],
    ['支付订单数', paidOrderCount],
    ['支付金额', paidAmount],
    ['rawAfterSaleCacheRowCount', afterSaleStats.rawAfterSaleCacheRowCount],
    ['rawAfterSaleRecordCount', afterSaleStats.rawAfterSaleRecordCount],
    ['exportedAfterSaleCount', afterSaleStats.rawOriginalRows.length],
    ['matchedAfterSaleCount', afterSaleStats.matchedAfterSaleCount],
    ['successfulAfterSaleCount', afterSaleStats.successfulAfterSaleCount],
    ['effectiveSuccessAfterSaleCount', afterSaleStats.effectiveSuccessAfterSaleCount],
    ['businessRefundAfterSaleCount', afterSaleStats.businessRefundAfterSaleCount],
    ['freightOnlyRefundCount', afterSaleStats.freightOnlyRefundCount],
    ['businessRefundAmountCent', afterSaleStats.businessRefundAmountCent],
    ['businessRefundAmountYuan', centToYuan(afterSaleStats.businessRefundAmountCent)],
    ['rawLiveSessionCount', normalizedLiveSessions.length],
    ['exportedLiveSessionCount', normalizedLiveSessions.length],
    ['数据来源', '本地同步数据'],
    ['售后数量说明', 'rawAfterSaleCacheRowCount=售后工作台缓存订单数；rawAfterSaleRecordCount=去重售后记录数；exportedAfterSaleCount=售后原始明细 Sheet 行数；matchedAfterSaleCount=售后明细 Sheet（已匹配订单主表）行数；businessRefundAfterSaleCount=计入业务退款的售后数'],
    [
      '售后退款口径说明',
      '18 元纯运费退款不计入退款金额与退款订单；用户实付仅作原始参考；业务退款优先取申请售后金额/实际退款金额；仅成功售后计入业务退款',
    ],
    [
      '售后状态口径说明',
      '已取消、已关闭、已拒绝、待寄回、待收货、待用户收货、处理中等不计入业务退款；同一售后单号保留最新状态',
    ],
    ['直播场次说明', '直播场次原始明细=官方同步场次列表；直播场次匹配汇总=系统主播归属与订单匹配汇总'],
    ['订单接口来源说明', '小红书订单列表/详情接口本地同步结果（xhsRawOrder）'],
    ['售后接口来源说明', '售后工作台接口本地同步结果（xhsAfterSalesWorkbenchCache）'],
    ['商品问题售后接口来源说明', '官方品质负反馈接口本地同步结果（qualityBadCase）'],
    ['直播场次接口来源说明', '小红书直播场次接口本地同步结果（xhsRawLiveSession）'],
    ['统计口径版本', BUSINESS_METRICS_VERSION],
    [
      '低价刷单过滤说明',
      `支付基数低于 ¥${(LOW_PRICE_BRUSH_THRESHOLD_CENT / 100).toFixed(2)} 的低价刷单订单保留在订单明细，但不计入主播业绩/买家排行`,
    ],
    ['支付金额_统计口径说明', '无支付时间的订单支付金额_统计口径为 0；有支付时间则保留实际支付基数（含后续取消/退款订单）'],
    ['原始金额列说明', '原始商品金额/原始用户应付/原始商家应收仅用于对照官方 Excel，不参与经营总览统计'],
    ['备注', '本核对包不受当前页面日期筛选影响'],
    ['导出用户', params.username ?? '—'],
    ['金额公式版本', AMOUNT_FORMULA_VERSION],
    ['支付金额字段说明', GMV_PAYMENT_FIELD_NOTE],
    ['最后同步成功时间', (await getBusinessSyncStatus()).businessSync.lastSuccessAt ?? '—'],
  ])

  const orderRows = viewsWithRaw.map((v) => {
    const row = mapViewToBoardOrderRow(v, { liveAccountContext: liveAccountCtx })
    const brush = resolveLowPriceBrushDebugFields(v)
    return [
      row.displayOrderNo,
      row.orderTime,
      pickPaymentTime(v, orderByMatchId),
      row.anchorName,
      row.liveAccountName ?? '—',
      row.buyerNickname,
      row.buyerId,
      row.productName,
      pickUnitPriceYuan(v),
      row.productTotalAmount,
      row.userPayableAmount,
      row.merchantReceivableAmount,
      statPaymentYuan(v, row, orderByMatchId),
      row.refundAmount,
      centToYuan(v.productRefundAmountCent ?? 0),
      yesNo(v.isFreightRefundOnly === true),
      yesNo(viewCountsAsRefundOrder(v)),
      row.signedAmount,
      row.orderStatus,
      row.afterSaleStatus,
      row.afterSaleReason,
      yesNo(row.includedInGmv),
      yesNo(row.isSigned),
      yesNo(row.isRefunded),
      yesNo(row.isQualityReturn),
      yesNo(brush.isLowPriceBrushOrder),
      statusNote(v),
    ]
  })

  addTableSheet(
    wb,
    '订单明细_标准化',
    [
      '订单号',
      '下单时间',
      '支付时间',
      '主播',
      '直播号来源',
      '买家昵称',
      '买家ID',
      '商品名称',
      '商品单价',
      '原始商品金额',
      '原始用户应付金额',
      '原始商家应收金额',
      '支付金额_统计口径',
      '退款金额',
      '业务退款金额',
      '是否纯运费退款',
      '是否计入退款订单',
      '实际签收金额',
      '订单状态',
      '售后状态',
      '售后原因',
      '是否计入支付金额',
      '是否签收',
      '是否退款',
      '是否品退',
      '是否低价刷单订单',
      '状态说明',
    ],
    orderRows,
  )

  addTableSheet(
    wb,
    '售后原始明细',
    [
      '直播号ID',
      '订单号',
      '包裹号',
      '售后单号',
      '订单号/包裹号(明细)',
      '买家昵称',
      '买家ID',
      '原始用户实付金额',
      '申请售后金额',
      '业务退款金额',
      '是否纯运费退款',
      '是否计入退款订单',
      '是否匹配订单主表',
      '匹配到的订单号',
      '售后状态(明细)',
      '售后原因(明细)',
      '状态说明',
      '售后类型',
      '申请时间',
      '完成时间',
      '工作台售后状态',
      '工作台售后原因',
      '工作台退款金额',
      '明细业务退款金额',
      '成功退货次数',
      'returnsIds',
    ],
    afterSaleStats.rawOriginalRows,
  )

  addTableSheet(
    wb,
    '售后明细',
    [
      '售后单号',
      '订单号 / 包裹号',
      '买家昵称',
      '买家ID',
      '原始用户实付金额',
      '申请售后金额',
      '业务退款金额',
      '是否纯运费退款',
      '是否计入退款订单',
      '是否匹配订单主表',
      '匹配到的订单号',
      '售后状态',
      '售后原因',
      '状态说明',
      '售后类型',
      '申请时间',
      '完成时间',
    ],
    afterSaleStats.matchedRows,
  )

  addTableSheet(
    wb,
    '商品问题售后明细',
    [
      '订单号 / 包裹号',
      '商品问题原因',
      '品退来源',
      '售后状态',
      '是否成功售后',
      '匹配状态',
      '是否计入品退',
    ],
    qualityCases.map((c) => [
      c.packageId || c.matchedOrderNo,
      c.negativeReasons?.length ? c.negativeReasons.join('、') : c.problemType,
      c.source === 'official_quality_badcase' ? '官方品质负反馈' : s(c.source),
      c.afterSaleStatus || '—',
      c.afterSaleRefunded ? '是' : '否',
      matchStatusLabel(c.matchStatus),
      c.afterSaleRefunded ? '是' : '否',
    ]),
  )

  const liveSessionRawRows = buildLiveSessionRawRows(
    normalizedLiveSessions,
    liveAccountBySessionId,
    liveAccountIdBySessionId,
    viewsWithRaw,
  )

  addTableSheet(
    wb,
    '直播场次原始明细',
    [
      '直播间id',
      '直播间名称',
      '直播号来源',
      '官方主播昵称',
      '小红书id',
      '直播开始时间',
      '直播结束时间',
      '直播时长(分钟)',
      '观看人数',
      '观看次数',
      '曝光人数',
      '商品曝光人数',
      '成交订单数',
      '成交金额',
      '是否匹配系统主播',
      '匹配主播',
      '匹配规则说明',
    ],
    liveSessionRawRows,
  )

  addTableSheet(
    wb,
    '直播场次匹配汇总',
    [
      '直播号',
      '主播',
      '匹配场次数',
      '匹配订单数',
      '匹配支付金额',
      '未归属订单数',
      '未归属支付金额',
    ],
    buildLiveSessionMatchSummary(
      normalizedLiveSessions,
      liveAccountBySessionId,
      viewsWithRaw,
    ),
  )

  addTableSheet(wb, '经营总览_全量重算值', ['指标', '数值'], [
    ['支付金额', metrics.totalGmv],
    ['有效成交额', metrics.validSalesAmount],
    ['实际签收金额', metrics.actualSignedAmount],
    ['退款金额', metrics.refundAmount],
    ['支付订单数', metrics.orderCount],
    ['签收单数', metrics.signedOrderCount],
    ['退款单数', metrics.refundOrderCount],
    ['品退单数', metrics.qualityRefundOrderCount],
    ['退款率', metrics.refundRate == null ? '—' : formatRate(metrics.refundRate)],
    ['品退率', metrics.qualityRefundRate == null ? '—' : formatRate(metrics.qualityRefundRate)],
    ['签收率', metrics.signRate == null ? '—' : formatRate(metrics.signRate)],
  ])

  addTableSheet(
    wb,
    '主播业绩_全量重算值',
    [
      '主播',
      '支付金额',
      '有效成交额',
      '签收金额',
      '支付订单数',
      '签收单数',
      '退款金额',
      '退款单数',
      '品退单数',
      '退款率',
      '品退率',
      '签收率',
      '参与订单号列表',
    ],
    anchors.map((a) => {
      const ids = anchorViews
        .filter((v) => v.anchorName === a.anchorName)
        .map((v) => v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId)
        .filter(Boolean)
        .join(',')
      return [
        a.anchorName,
        a.totalGmv,
        a.validSalesAmount,
        a.actualSignedAmount,
        a.orderCount,
        a.signedCount,
        a.returnAmount,
        a.returnCount,
        a.qualityReturnCount,
        a.returnRate == null ? '—' : formatRate(a.returnRate),
        a.qualityReturnRate == null ? '—' : formatRate(a.qualityReturnRate),
        a.signRate == null ? '—' : formatRate(a.signRate),
        ids,
      ]
    }),
  )

  const sampleMeta = buyerProfile?.sampleMeta
  const sampleDesc =
    sampleMeta?.sampleDescription ??
    '按订单支付时间统计，客户按买家ID去重；单价低于阈值的低价刷单订单在买家排行中排除'

  addTableSheet(
    wb,
    '买家排行样本',
    [
      '买家ID',
      '买家昵称',
      '订单数',
      '支付金额',
      '签收金额',
      '退款金额',
      '退款次数',
      '品退次数',
      '客户标签',
      '是否排除低价刷单订单',
      '样本说明',
    ],
    (buyerProfile?.items ?? []).map((b: BuyerRankingItem) => [
      b.buyerId,
      b.nickname,
      b.orderCount,
      b.gmv,
      b.signedAmount,
      b.productRefundAmount,
      b.refundTimes ?? b.refundCount ?? 0,
      b.qualityReturnCount,
      b.customerTags?.length ? b.customerTags.join('、') : s(b.customerTag),
      '否',
      sampleDesc,
    ]),
  )

  const abnormal: unknown[][] = []
  for (const orderNo of artifacts.abnormalOrderNos ?? []) {
    abnormal.push(['时间异常', orderNo, '下单/支付/完成时间无效', '—', '—', '未计入统计'])
  }
  for (const v of viewsWithRaw) {
    if (!v.includedInGmv && v.gmvExcludeReason) {
      abnormal.push([
        'GMV排除',
        v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId,
        v.gmvExcludeReason,
        centToYuan(v.paymentBaseCent),
        v.orderStatusText,
        '核对支付金额口径',
      ])
    }
    if (isLowPriceBrushOrderView(v)) {
      abnormal.push([
        '低价刷单',
        v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId,
        resolveLowPriceBrushDebugFields(v).lowPriceBrushReason ?? 'unit_price_below_threshold',
        centToYuan(v.paymentBaseCent),
        v.orderStatusText,
        '主播业绩/买家排行已排除，订单明细仍保留',
      ])
    }
    if (v.anchorName === '未归属' || !v.anchorName?.trim()) {
      abnormal.push([
        '未归属主播',
        v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId,
        v.attributionType,
        centToYuan(v.paymentBaseCent),
        v.orderStatusText,
        '检查直播场次/主播配置',
      ])
    }
    if (isQualityRefundOrder(v) && !v.finalAfterSaleReason) {
      abnormal.push([
        '品退待确认',
        v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId,
        '品退信号存在但售后原因不完整',
        centToYuan(v.productRefundAmountCent),
        v.afterSaleStatusText,
        '对照商品问题售后明细',
      ])
    }
  }

  addTableSheet(
    wb,
    '异常数据',
    ['异常类型', '订单号', '原因', '金额', '状态', '处理建议'],
    abnormal,
  )

  const buf = await wb.xlsx.writeBuffer()
  return {
    buffer: Buffer.from(buf),
    filename: `全部已同步数据核对包_${ts}.xlsx`,
  }
}
