import type { UserRole } from '../types/roles'
import type { AnalyzedOrderView, LiveSession, SettlementRecord } from '../types/analysis'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { centToYuan } from '../utils/money'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { prisma } from '../lib/prisma'
import { clampPagination, paginatedResponse } from '../utils/pagination'

const DEFAULT_PAGE_SIZE = 20

export interface BiRangeQuery {
  preset?: string
  startDate?: string
  endDate?: string
}

export interface BiPagination {
  page?: number
  pageSize?: number
}

function clampPage(p?: number): number {
  const n = Number(p ?? 1)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

function clampPageSize(ps?: number): number {
  return clampPagination(1, ps).pageSize
}

function resolveRange(q: BiRangeQuery) {
  return resolveDateRange(
    (q.preset ?? 'thisMonth') as DateRangePreset,
    q.startDate,
    q.endDate,
  )
}

type OrderSettlementAgg = {
  pendingIncomeCent: number
  settledIncomeCent: number
  refundCent: number
  feeCent: number
}

interface BiContext {
  range: ReturnType<typeof resolveRange>
  trustStatus: string
  canDrill: boolean
  previewOnly: boolean
  blocked: boolean
  message: string | null
  views: AnalyzedOrderView[]
  liveSessions: LiveSession[]
  pendingRecords: SettlementRecord[]
  settledRecords: SettlementRecord[]
  settlementByOrder: Map<string, OrderSettlementAgg>
  abnormalByOrderId: Map<string, string[]>
}

async function loadBiContext(q: BiRangeQuery): Promise<BiContext> {
  const range = resolveRange(q)
  const bundle = await buildRawAnalyzeBundle(range)
  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const views = artifacts?.views ?? []
  const trustStatus = views.length > 0 ? 'official_ready' : 'blocked'

  if (views.length === 0) {
    return {
      range,
      trustStatus: 'blocked',
      canDrill: false,
      previewOnly: false,
      blocked: true,
      message: '当前范围暂无可钻取数据，请先通过实时查询拉取当前范围订单。',
      views: [],
      liveSessions: [],
      pendingRecords: [],
      settledRecords: [],
      settlementByOrder: new Map(),
      abnormalByOrderId: new Map(),
    }
  }

  if (!bundle || !artifacts) {
    return {
      range,
      trustStatus,
      canDrill: false,
      previewOnly: false,
      blocked: false,
      message: '当前范围暂无同步数据，请先通过实时查询拉取订单。',
      views: [],
      liveSessions: [],
      pendingRecords: [],
      settledRecords: [],
      settlementByOrder: new Map(),
      abnormalByOrderId: new Map(),
    }
  }

  const orderIds = new Set(artifacts.views.map((v) => v.matchOrderId || v.orderId))
  const settlementByOrder = new Map<string, OrderSettlementAgg>()

  const touch = (orderId: string): OrderSettlementAgg => {
    if (!settlementByOrder.has(orderId)) {
      settlementByOrder.set(orderId, {
        pendingIncomeCent: 0,
        settledIncomeCent: 0,
        refundCent: 0,
        feeCent: 0,
      })
    }
    return settlementByOrder.get(orderId)!
  }

  for (const r of artifacts.settlement?.pendingRecords ?? []) {
    if (!r.orderId || !orderIds.has(r.orderId)) continue
    const b = touch(r.orderId)
    if (r.direction === 'income') b.pendingIncomeCent += Math.max(0, r.amountCent)
    else if (r.direction === 'refund') b.refundCent += Math.abs(r.amountCent)
    else if (r.direction === 'fee') b.feeCent += Math.abs(r.amountCent)
  }
  for (const r of artifacts.settlement?.settledRecords ?? []) {
    if (!r.orderId || !orderIds.has(r.orderId)) continue
    const b = touch(r.orderId)
    if (r.direction === 'income') b.settledIncomeCent += Math.max(0, r.amountCent)
    else if (r.direction === 'refund') b.refundCent += Math.abs(r.amountCent)
    else if (r.direction === 'fee') b.feeCent += Math.abs(r.amountCent)
  }

  const abnormalByOrderId = new Map<string, string[]>()
  for (const o of artifacts.dedupe.abnormalOrders) {
    const id = o.matchOrderId || o.orderId
    if (id) abnormalByOrderId.set(id, o.errors)
  }

  return {
    range,
    trustStatus,
    canDrill: true,
    previewOnly: false,
    blocked: false,
    message: null,
    views: artifacts.views,
    liveSessions: artifacts.liveSessions,
    pendingRecords: artifacts.settlement?.pendingRecords ?? [],
    settledRecords: artifacts.settlement?.settledRecords ?? [],
    settlementByOrder,
    abnormalByOrderId,
  }
}

function attributionLabel(type: string): string {
  const map: Record<string, string> = {
    order_anchor_field: '订单主播字段',
    live_anchor_field: '直播场次匹配',
    live_time_rule: '直播时间规则',
    time_rule: '时间段规则',
    unassigned: '未归属',
    abnormal: '异常',
  }
  return map[type] ?? type
}

function mapOrderRow(
  v: AnalyzedOrderView,
  ctx: BiContext,
  role: UserRole,
): Record<string, unknown> {
  const matchId = v.matchOrderId || v.orderId
  const st = ctx.settlementByOrder.get(matchId)
  const abnormal = ctx.abnormalByOrderId.get(matchId)
  const row: Record<string, unknown> = {
    orderId: v.bizOrderId || v.orderId,
    packageId: v.packageId || matchId,
    orderTime: v.orderTimeText,
    buyerId: v.buyerId,
    anchorName: v.anchorName || '—',
    liveAccountName: v.liveAccountName?.trim() || '未知直播号',
    productGmv: centToYuan(v.gmvCent),
    gmv: centToYuan(v.effectiveGmvCent),
    effectiveGmv: centToYuan(v.effectiveGmvCent),
    returnAmount: centToYuan(v.returnAmountCent),
    receivableAmount: centToYuan(v.receivableAmountCent),
    freight: centToYuan(v.freightCent),
    platformDiscount: centToYuan(v.platformDiscountCent),
    actualPaid: centToYuan(v.actualPaidCent),
    actualSignedAmount: centToYuan(v.isActualSigned ? v.actualSignedAmountCent : 0),
    orderStatus: v.isReturned ? '退货' : v.isSigned ? '已签收' : '—',
    afterSaleStatus: v.isReturned ? '退货' : '—',
    isReturned: v.isReturned,
    isQualityReturn: v.isQualityReturn,
    qualityReturnReason: v.isQualityReturn ? v.reasonText : '',
    settledAmount: centToYuan(st?.settledIncomeCent ?? 0),
    pendingAmount: centToYuan(st?.pendingIncomeCent ?? 0),
    attributionType: attributionLabel(v.attributionType),
    abnormalHint: abnormal?.length ? abnormal.join('；') : null,
  }
  if (role === 'super_admin' && abnormal?.length) {
    row.abnormalDetail = abnormal
  }
  if (role !== 'super_admin') {
    delete row.abnormalHint
    delete row.abnormalDetail
  }
  return row
}

function filterOrders(
  views: AnalyzedOrderView[],
  params: {
    anchorName?: string
    statusType?: string
    buyerId?: string
    orderId?: string
  },
): AnalyzedOrderView[] {
  let list = [...views]
  const anchor = params.anchorName?.trim()
  if (anchor && anchor !== '全部') {
    list = list.filter((v) => v.anchorName.includes(anchor))
  }
  const buyer = params.buyerId?.trim()
  if (buyer) {
    list = list.filter((v) => v.buyerId.includes(buyer))
  }
  const orderSearch = params.orderId?.trim()
  if (orderSearch) {
    list = list.filter((v) => v.orderId.includes(orderSearch))
  }
  switch (params.statusType) {
    case 'signed':
      list = list.filter((v) => v.isActualSigned)
      break
    case 'returned':
      list = list.filter((v) => v.isReturned)
      break
    case 'quality_return':
      list = list.filter((v) => v.isQualityReturn)
      break
    case 'unassigned':
      list = list.filter((v) => v.attributionType === 'unassigned')
      break
    case 'abnormal':
      list = list.filter((v) => v.attributionType === 'abnormal')
      break
    default:
      break
  }
  return list
}

function sortOrdersWithSettlement(
  list: AnalyzedOrderView[],
  settlementByOrder: Map<string, OrderSettlementAgg>,
  sortField?: string,
  sortOrder?: string,
): AnalyzedOrderView[] {
  const field = sortField ?? 'orderTime'
  const dir = sortOrder === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const stA = settlementByOrder.get(a.orderId)
    const stB = settlementByOrder.get(b.orderId)
    let av = 0
    let bv = 0
    if (field === 'gmv') {
      av = a.gmvCent
      bv = b.gmvCent
    } else if (field === 'returnAmount') {
      av = a.returnAmountCent
      bv = b.returnAmountCent
    } else if (field === 'settledAmount') {
      av = stA?.settledIncomeCent ?? 0
      bv = stB?.settledIncomeCent ?? 0
    } else if (field === 'pendingAmount') {
      av = stA?.pendingIncomeCent ?? 0
      bv = stB?.pendingIncomeCent ?? 0
    } else {
      return a.orderTimeText.localeCompare(b.orderTimeText) * dir
    }
    return (av - bv) * dir
  })
}

export async function getBiSummary(q: BiRangeQuery, role: UserRole) {
  const ctx = await loadBiContext(q)
  const base = {
    preset: q.preset ?? null,
    startDate: ctx.range.startDate,
    endDate: ctx.range.endDate,
    trustStatus: ctx.trustStatus,
    canDrill: ctx.canDrill,
    previewOnly: ctx.previewOnly,
    blocked: ctx.blocked,
    message: ctx.message,
    orderCount: ctx.views.length,
    liveSessionCount: ctx.liveSessions.length,
    pendingSettlementCount: ctx.pendingRecords.length,
    settledSettlementCount: ctx.settledRecords.length,
  }
  if (!ctx.canDrill) return base

  const gmvCent = ctx.views.reduce((s, v) => s + v.gmvCent, 0)
  const returnCount = ctx.views.filter((v) => v.isReturned).length
  return {
    ...base,
    gmv: centToYuan(gmvCent),
    returnCount,
    returnRate: ctx.views.length > 0 ? returnCount / ctx.views.length : 0,
    qualityReturnCount: ctx.views.filter((v) => v.isQualityReturn).length,
    actualSignedAmount: centToYuan(
      ctx.views
        .filter((v) => v.isActualSigned)
        .reduce((s, v) => s + (v.actualSignedAmountCent || 0), 0),
    ),
    role,
  }
}

export async function drillOrders(
  q: BiRangeQuery & {
    anchorName?: string
    statusType?: string
    buyerId?: string
    orderId?: string
    page?: number
    pageSize?: number
    sortField?: string
    sortOrder?: string
  },
  role: UserRole,
) {
  const ctx = await loadBiContext(q)
  if (!ctx.canDrill) {
    return {
      ...paginatedResponse([], 1, DEFAULT_PAGE_SIZE, 0),
      summary: null,
      message: ctx.message,
      trustStatus: ctx.trustStatus,
      previewOnly: ctx.previewOnly,
    }
  }

  let list = filterOrders(ctx.views, q)
  list = sortOrdersWithSettlement(list, ctx.settlementByOrder, q.sortField, q.sortOrder)

  const total = list.length
  const page = clampPage(q.page)
  const pageSize = clampPageSize(q.pageSize)
  const start = (page - 1) * pageSize
  const slice = list.slice(start, start + pageSize)

  const summary = {
    totalOrders: total,
    gmv: centToYuan(list.reduce((s, v) => s + v.gmvCent, 0)),
    returnedCount: list.filter((v) => v.isReturned).length,
    qualityReturnCount: list.filter((v) => v.isQualityReturn).length,
  }

  return {
    ...paginatedResponse(
      slice.map((v) => mapOrderRow(v, ctx, role)),
      page,
      pageSize,
      total,
      summary,
    ),
    message: ctx.message,
    trustStatus: ctx.trustStatus,
    previewOnly: ctx.previewOnly,
  }
}

export async function drillSettlements(
  q: BiRangeQuery & {
    anchorName?: string
    type?: string
    page?: number
    pageSize?: number
  },
  role: UserRole,
) {
  const ctx = await loadBiContext(q)
  if (!ctx.canDrill) {
    return {
      ...paginatedResponse([], 1, DEFAULT_PAGE_SIZE, 0),
      summary: null,
      message: ctx.message,
    }
  }

  const orderAnchor = new Map(ctx.views.map((v) => [v.orderId, v.anchorName]))
  const orderTimeById = new Map(ctx.views.map((v) => [v.orderId, v.orderTimeText]))
  const orderIds = new Set(ctx.views.map((v) => v.orderId))

  type Row = SettlementRecord & { anchorName: string; matched: boolean }
  const rows: Row[] = []

  const pushRows = (records: SettlementRecord[], billType: 'pending' | 'settled') => {
    for (const r of records) {
      const matched = Boolean(r.orderId && orderIds.has(r.orderId))
      rows.push(
        Object.assign(r, {
          anchorName: r.orderId ? orderAnchor.get(r.orderId) ?? '—' : '—',
          matched,
          settlementType: billType,
        }) as Row,
      )
    }
  }

  pushRows(ctx.pendingRecords, 'pending')
  pushRows(ctx.settledRecords, 'settled')

  let filtered = rows
  const anchor = q.anchorName?.trim()
  if (anchor && anchor !== '全部') {
    filtered = filtered.filter((r) => r.anchorName.includes(anchor))
  }

  switch (q.type) {
    case 'settled':
      filtered = filtered.filter((r) => r.settlementType === 'settled' && r.direction === 'income')
      break
    case 'pending':
      filtered = filtered.filter((r) => r.settlementType === 'pending' && r.direction === 'income')
      break
    case 'refund':
      filtered = filtered.filter((r) => r.direction === 'refund')
      break
    case 'fee':
      filtered = filtered.filter((r) => r.direction === 'fee')
      break
    case 'unmatched':
      filtered = filtered.filter((r) => !r.matched)
      break
    default:
      break
  }

  const summary = {
    settledAmount: centToYuan(
      rows.filter((r) => r.settlementType === 'settled' && r.direction === 'income').reduce((s, r) => s + r.amountCent, 0),
    ),
    pendingAmount: centToYuan(
      rows.filter((r) => r.settlementType === 'pending' && r.direction === 'income').reduce((s, r) => s + r.amountCent, 0),
    ),
    refundAmount: centToYuan(rows.filter((r) => r.direction === 'refund').reduce((s, r) => s + r.amountCent, 0)),
    feeAmount: centToYuan(rows.filter((r) => r.direction === 'fee').reduce((s, r) => s + r.amountCent, 0)),
    unmatchedCount: rows.filter((r) => r.orderId && !orderIds.has(r.orderId)).length,
  }

  const total = filtered.length
  const page = clampPage(q.page)
  const pageSize = clampPageSize(q.pageSize)
  const start = (page - 1) * pageSize
  const slice = filtered.slice(start, start + pageSize)

  const items = slice.map((r) => ({
    orderId: r.orderId,
    packageId: r.orderId,
    anchorName: r.anchorName,
    settlementType: r.settlementType === 'settled' ? '已结算' : '待结算',
    amount: centToYuan(r.amountCent),
    direction: r.direction === 'income' ? '收入' : r.direction === 'refund' ? '退款' : r.direction === 'fee' ? '扣费' : '—',
    orderTime: r.orderId ? orderTimeById.get(r.orderId) ?? '—' : '—',
    settlementTime: r.settlementTimeText ?? '—',
    transactionType: r.statusText,
    orderStatus: '—',
    matched: r.matched,
    diffNote: !r.matched ? '结算记录不在本次订单范围' : null,
  }))

  return {
    ...paginatedResponse(items, page, pageSize, total, summary),
    formula:
      '毛利润 = 已结算正向收入 + 待结算正向收入 - 退款扣回 - 平台扣费/服务费；未扣商品采购成本。',
    trustStatus: ctx.trustStatus,
    previewOnly: ctx.previewOnly,
    role,
  }
}

export async function drillBuyers(
  q: BiRangeQuery & { type?: string; page?: number; pageSize?: number },
  _role: UserRole,
) {
  const ctx = await loadBiContext(q)
  if (!ctx.canDrill) {
    return {
      ...paginatedResponse([], 1, DEFAULT_PAGE_SIZE, 0),
      message: ctx.message,
    }
  }

  const byBuyer = new Map<
    string,
    {
      buyerId: string
      orderCount: number
      returnCount: number
      returnAmountCent: number
      qualityReturnCount: number
      qualityReturnAmountCent: number
      lastOrderTime: string
      lastReturnTime: string
      anchors: Set<string>
    }
  >()

  for (const v of ctx.views) {
    if (!v.buyerId) continue
    if (!byBuyer.has(v.buyerId)) {
      byBuyer.set(v.buyerId, {
        buyerId: v.buyerId,
        orderCount: 0,
        returnCount: 0,
        returnAmountCent: 0,
        qualityReturnCount: 0,
        qualityReturnAmountCent: 0,
        lastOrderTime: v.orderTimeText,
        lastReturnTime: '',
        anchors: new Set(),
      })
    }
    const b = byBuyer.get(v.buyerId)!
    b.orderCount += 1
    if (v.anchorName) b.anchors.add(v.anchorName)
    if (v.orderTimeText > b.lastOrderTime) b.lastOrderTime = v.orderTimeText
    if (v.isReturned) {
      b.returnCount += 1
      b.returnAmountCent += v.returnAmountCent || v.gmvCent
      if (v.orderTimeText > b.lastReturnTime) b.lastReturnTime = v.orderTimeText
    }
    if (v.isQualityReturn) {
      b.qualityReturnCount += 1
      b.qualityReturnAmountCent += v.returnAmountCent || v.gmvCent
    }
  }

  let list = [...byBuyer.values()]
  if (q.type === 'return') list = list.filter((b) => b.returnCount > 0)
  if (q.type === 'quality_return') list = list.filter((b) => b.qualityReturnCount > 0)
  if (q.type === 'high_value') list = list.filter((b) => b.returnAmountCent >= 100_000)

  list.sort((a, b) => b.returnAmountCent - a.returnAmountCent)

  const total = list.length
  const page = clampPage(q.page)
  const pageSize = clampPageSize(q.pageSize)
  const slice = list.slice((page - 1) * pageSize, page * pageSize)

  const items = slice.map((b) => {
    const tags: string[] = []
    if (b.returnCount >= 3) tags.push('高频退货')
    if (b.qualityReturnCount >= 2) tags.push('高频品退')
    if (centToYuan(b.returnAmountCent) >= 10000) tags.push('高金额退货')
    if (b.anchors.size >= 2) tags.push('多主播重复出现')
    return {
      buyerId: b.buyerId,
      nickname: b.buyerId,
      orderCount: b.orderCount,
      returnCount: b.returnCount,
      returnAmount: centToYuan(b.returnAmountCent),
      qualityReturnCount: b.qualityReturnCount,
      qualityReturnAmount: centToYuan(b.qualityReturnAmountCent),
      lastOrderTime: b.lastOrderTime,
      lastReturnTime: b.lastReturnTime || '—',
      anchors: [...b.anchors].join('、'),
      riskTags: tags,
    }
  })

  return {
    ...paginatedResponse(items, page, pageSize, total),
    trustStatus: ctx.trustStatus,
    previewOnly: ctx.previewOnly,
  }
}

export async function drillLiveSessions(
  q: BiRangeQuery & { anchorName?: string; page?: number; pageSize?: number },
  _role: UserRole,
) {
  const ctx = await loadBiContext(q)
  if (!ctx.canDrill) {
    return {
      ...paginatedResponse([], 1, DEFAULT_PAGE_SIZE, 0),
      message: ctx.message,
    }
  }

  let sessions = ctx.liveSessions
  const anchor = q.anchorName?.trim()
  if (anchor && anchor !== '全部') {
    sessions = sessions.filter((s) => (s.anchorName ?? '').includes(anchor))
  }

  const rows = sessions.map((s) => {
    const raw = s.raw as Record<string, unknown>
    const income = raw.sellerRealIncomeAmt as { value?: number; displayValue?: string } | undefined
    const refund = raw.refundAmt as { value?: number; displayValue?: string } | undefined
    const attrOrders = ctx.views.filter(
      (v) =>
        v.anchorName === (s.anchorName ?? '') &&
        v.matchedLiveStartTime &&
        v.matchedLiveStartTime === s.startTimeText,
    )
    const attrGmvCent = attrOrders.reduce((sum, v) => sum + v.gmvCent, 0)
    return {
      liveId: s.id,
      anchorName: s.anchorName ?? '—',
      liveName: String(raw.liveName ?? raw.title ?? '—'),
      startTime: s.startTimeText,
      endTime: s.endTimeText,
      durationMinutes: s.durationMinutes,
      liveGmv: income?.displayValue
        ? Number(String(income.displayValue).replace(/[^\d.-]/g, '')) || 0
        : centToYuan(Math.abs(Number(income?.value ?? 0)) >= 10000 ? Number(income?.value ?? 0) / 100 : Number(income?.value ?? 0)),
      refundAmount: refund?.displayValue
        ? Number(String(refund.displayValue).replace(/[^\d.-]/g, '')) || 0
        : centToYuan(Math.abs(Number(refund?.value ?? 0)) >= 10000 ? Number(refund?.value ?? 0) / 100 : Number(refund?.value ?? 0)),
      payOrderCount: Number(raw.payOrderCnt ?? raw.orderCnt ?? 0),
      refundOrderCount: Number(raw.refundOrderCnt ?? 0),
      attributedOrderCount: attrOrders.length,
      attributedGmv: centToYuan(attrGmvCent),
    }
  })

  const total = rows.length
  const page = clampPage(q.page)
  const pageSize = clampPageSize(q.pageSize)
  const slice = rows.slice((page - 1) * pageSize, page * pageSize)

  return {
    ...paginatedResponse(slice, page, pageSize, total),
    trustStatus: ctx.trustStatus,
    previewOnly: ctx.previewOnly,
  }
}

export async function drillDailyTrend(
  q: BiRangeQuery & { metric?: string },
  _role: UserRole,
) {
  const ctx = await loadBiContext(q)
  if (!ctx.canDrill) {
    return { points: [], message: ctx.message }
  }

  const metric = q.metric ?? 'gmv'
  const byDay = new Map<string, AnalyzedOrderView[]>()

  for (const v of ctx.views) {
    const day = v.orderTimeText.slice(0, 10)
    if (!day || day.length < 8) continue
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(v)
  }

  const points = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, orders]) => {
      const orderCount = orders.length
      const gmvCent = orders.reduce((s, o) => s + o.gmvCent, 0)
      const returnCount = orders.filter((o) => o.isReturned).length
      const signedCent = orders
        .filter((o) => o.isActualSigned)
        .reduce((s, o) => s + (o.actualSignedAmountCent || 0), 0)
      const qualityCent = orders
        .filter((o) => o.isQualityReturn)
        .reduce((s, o) => s + (o.returnAmountCent || o.gmvCent), 0)

      let value = 0
      switch (metric) {
        case 'order_count':
          value = orderCount
          break
        case 'signed_amount':
          value = centToYuan(signedCent)
          break
        case 'return_count':
          value = returnCount
          break
        case 'return_rate':
          value = orderCount > 0 ? returnCount / orderCount : 0
          break
        case 'quality_return_amount':
          value = centToYuan(qualityCent)
          break
        case 'gross_profit': {
          const dayOrderIds = new Set(orders.map((o) => o.matchOrderId || o.orderId))
          let settled = 0
          let pending = 0
          let refund = 0
          let fee = 0
          for (const r of [...ctx.pendingRecords, ...ctx.settledRecords]) {
            if (!r.orderId || !dayOrderIds.has(r.orderId)) continue
            if (r.direction === 'income') {
              const inc = Math.max(0, r.amountCent)
              if (r.settlementType === 'settled') settled += inc
              else pending += inc
            } else if (r.direction === 'refund') refund += Math.abs(r.amountCent)
            else if (r.direction === 'fee') fee += Math.abs(r.amountCent)
          }
          value = centToYuan(settled + pending - refund - fee)
          break
        }
        default:
          value = centToYuan(gmvCent)
      }

      return { date, value, orderCount }
    })

  return {
    points,
    metric,
    trustStatus: ctx.trustStatus,
    previewOnly: ctx.previewOnly,
  }
}

export async function getOrderDetail(orderId: string, q: BiRangeQuery, role: UserRole) {
  const ctx = await loadBiContext(q)
  if (!ctx.canDrill) {
    return { message: ctx.message }
  }

  const view = ctx.views.find((v) => v.orderId === orderId)
  if (!view) {
    return { message: '订单不在当前范围内' }
  }

  const raw = await prisma.xhsRawOrder.findFirst({
    where: { orderId },
    select: { rawJson: true, packageId: true, orderTime: true, buyerId: true },
  })

  let rawSummary: Record<string, unknown> | null = null
  if (role === 'super_admin' && raw?.rawJson && typeof raw.rawJson === 'object') {
    const j = raw.rawJson as Record<string, unknown>
    rawSummary = {
      orderId: j.orderId ?? j.packageId,
      status: j.status,
      payAmount: j.payAmount ?? j.totalOrderAmount,
    }
  }

  const st = ctx.settlementByOrder.get(orderId)
  const bills = [
    ...ctx.pendingRecords.filter((r) => r.orderId === orderId),
    ...ctx.settledRecords.filter((r) => r.orderId === orderId),
  ].map((r) => ({
    type: r.settlementType === 'settled' ? '已结算' : '待结算',
    direction: r.direction,
    amount: centToYuan(r.amountCent),
    time: r.settlementTimeText,
  }))

  return {
    order: mapOrderRow(view, ctx, role),
    settlementBills: bills,
    settlementSummary: st
      ? {
          settled: centToYuan(st.settledIncomeCent),
          pending: centToYuan(st.pendingIncomeCent),
          refund: centToYuan(st.refundCent),
          fee: centToYuan(st.feeCent),
        }
      : null,
    rawSummary,
    trustStatus: ctx.trustStatus,
    previewOnly: ctx.previewOnly,
  }
}
