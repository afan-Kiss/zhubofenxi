/**
 * 上月对比 / ChatGPT 分析数据导出
 * 基于现有经营缓存 + XhsRawLiveSession（含回放补齐字段），不改写归属口径。
 */
import { prisma } from '../lib/prisma'
import type { AnalyzedOrderView } from '../types/analysis'
import { formatDateKeyShanghai, formatDateTimeShanghai } from '../utils/business-timezone'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import { getOrBuildBusinessBoardCache } from './business-cache.service'
import { calculateBusinessMetrics } from './business-metrics.service'
import { extractLiveSessionTraffic } from './live-session-traffic.util'
import { resolveGoodReviewShopKey, GOOD_REVIEW_SHOPS } from '../config/good-review-shops.constants'
import { getSetting } from './system-setting.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { matchLiveSessionToScheduleSegments } from './daily-report-live-schedule-match.service'
import { formatLiveDurationMinutes } from './anchor-live-sessions.service'
import type { AnchorLiveSessionBrief } from './anchor-live-sessions.service'
import {
  shiftMonthSameDay,
  unionMapKeys,
  pickPrimaryCanonicalAnchorName,
  readLiveReviewPartsStatus,
  liveReviewPartsFullyComplete,
} from './xhs-api-sync/xhs-live-review-enrich.util'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'object' && v && 'value' in (v as object)) {
    return num((v as { value: unknown }).value)
  }
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function unwrapField(raw: Record<string, unknown>, key: string): unknown {
  const v = raw[key]
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object)) {
    return (v as { value: unknown }).value
  }
  return v
}

function rateObj(numerator: number, denominator: number) {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
  }
}

function addDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function weekdayShanghai(dateKey: string): number {
  // 0=周日 … 用中午 UTC+8 避免边界
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 4, 0, 0)) // 12:00 CST
  return dt.getUTCDay()
}

type SessionRow = {
  id: string
  liveId: string | null
  liveName: string | null
  liveAccountId: string
  liveAccountName: string | null
  startTime: Date | null
  endTime: Date | null
  anchorName: string | null
  rawJson: unknown
}

function sessionDurationHours(s: SessionRow): number {
  if (!s.startTime) return 0
  const end = s.endTime?.getTime() ?? Date.now()
  return Math.max(0, (end - s.startTime.getTime()) / 3600000)
}

function extractSessionMetrics(s: SessionRow) {
  const raw = asRecord(s.rawJson) ?? {}
  const overview = asRecord(raw._liveReviewOverview)
  const traffic = asRecord(raw._liveReviewTrafficCore)
  const transform = asRecord(raw._liveReviewTransform)
  const notes = Array.isArray(raw._liveReviewNotes) ? raw._liveReviewNotes : []
  const coverList = Array.isArray(raw._liveReviewCoverList) ? raw._liveReviewCoverList : []
  const trafficExtract = extractLiveSessionTraffic(raw)

  const paymentGmv =
    num(unwrapField(raw, 'sellerRealIncomeAmt')) ??
    num(overview?.gmv) ??
    0
  const refundAmount =
    num(unwrapField(raw, 'refundAmt')) ?? num(traffic?.refundAmount) ?? 0
  const dealOrders = num(unwrapField(raw, 'dealOrderCnt')) ?? num(traffic?.dealPkgCnt) ?? 0
  const dealUsers = num(unwrapField(raw, 'dealUserNum')) ?? num(traffic?.dealUv) ?? 0
  const viewUv =
    num(unwrapField(raw, 'serverLiveViewUserNum')) ??
    num(traffic?.joinUv) ??
    num(overview?.liveUv) ??
    0
  const impressionUv =
    num(unwrapField(raw, 'liveTotalImpressionUserNum')) ?? num(traffic?.liveImpressionUv) ?? 0
  const impressionCnt =
    num(unwrapField(raw, 'liveTotalImpressionCnt')) ??
    num(traffic?.liveImpressionCnt) ??
    trafficExtract.impressionCount ??
    0
  const cardImpressionUv = num(unwrapField(raw, 'liveroomCardImpressionUserNum'))
  const cardImpressionCnt = num(unwrapField(raw, 'liveroomCardImpression'))
  const goodsClickUsers = num(unwrapField(raw, 'goodsClickUserNum'))
  const goodsClickCnt = num(unwrapField(raw, 'goodsClickCnt'))
  const shopKey = resolveGoodReviewShopKey(s.liveAccountName ?? '')
  const partsStatus = readLiveReviewPartsStatus(raw)

  return {
    sessionId: s.liveId ?? s.id,
    dbId: s.id,
    shopKey,
    shopName: s.liveAccountName,
    title: s.liveName ?? (overview?.title ? String(overview.title) : null),
    startTime: s.startTime?.toISOString() ?? null,
    endTime: s.endTime?.toISOString() ?? null,
    durationHours: Number(sessionDurationHours(s).toFixed(3)),
    listAnchorName: s.anchorName,
    canonicalAnchorName: null as string | null,
    liveReviewPartsStatus: partsStatus,
    liveReviewFullyComplete: liveReviewPartsFullyComplete(partsStatus),
    paymentGmv,
    refundAmount,
    dealOrders,
    dealUsers,
    viewUv,
    impressionUv,
    impressionCnt,
    cardImpressionUv,
    cardImpressionCnt,
    goodsClickUsers,
    goodsClickCnt,
    viewPayRate: num(unwrapField(raw, 'viewPayRate')) ?? num(traffic?.viewDealRate) ?? trafficExtract.viewPayRate,
    payRate: num(unwrapField(raw, 'payRate')) ?? num(overview?.buyRate),
    liveCtr: num(traffic?.liveCtr) ?? trafficExtract.coverClickRate,
    liveNoteNum: num(traffic?.liveNoteNum) ?? num(raw.liveNoteNum),
    noteDetailAvailable: raw._liveReviewNoteDetailAvailable === true,
    notes: notes.map((n) => {
      const r = asRecord(n) ?? {}
      return {
        noteId: r.noteId ?? null,
        title: r.noteTitle ?? null,
        noteReadCount: num(r.noteReadCount),
        noteTrafficViewCount: num(r.noteTrafficViewCount),
        noteReadToViewRate: num(r.noteReadToViewRate),
        noteLikeCount: num(r.noteLikeCount),
        noteCommentCount: num(r.noteCommentCount),
        noteFavoriteCount: num(r.noteFavoriteCount),
        notePublishTime: r.notePublishTime ?? null,
      }
    }),
    coverTraffic: coverList.map((c) => {
      const r = asRecord(c) ?? {}
      return {
        name: r.name ?? null,
        coverUrl: r.coverUrl ?? null,
        impressionCnt: num(r.impressionCnt),
        clickCnt: num(r.clickCnt),
        clickRate: num(r.clickRate),
      }
    }),
    transform,
    overview,
    traffic,
    dataQuality: trafficExtract.dataQuality,
  }
}

async function loadBoardPeriod(startDate: string, endDate: string) {
  const cache = await getOrBuildBusinessBoardCache({
    preset: 'custom',
    startDate,
    endDate,
    interactive: true,
  })
  const views = (cache.views ?? []) as AnalyzedOrderView[]
  const metrics = calculateBusinessMetrics(views)
  const paymentGmv = views.reduce((s, v) => s + (v.paymentBaseCent ?? 0), 0) / 100
  const orderCount = views.length
  const buyerSet = new Set(views.map((v) => v.buyerKey).filter(Boolean))
  const dealUsers = buyerSet.size
  const signedAmount = metrics.actualSignedAmount
  const signedOrders = metrics.signedOrderCount ?? 0
  const refundAmount = metrics.refundAmount
  const refundOrders = metrics.refundOrderCount ?? 0
  const unassigned = views.filter((v) => !v.anchorName || v.anchorName === '未归属').length
  const byAnchor = new Map<string, AnalyzedOrderView[]>()
  const byShop = new Map<string, AnalyzedOrderView[]>()
  for (const v of views) {
    const a = v.anchorName?.trim() || '未归属'
    if (!byAnchor.has(a)) byAnchor.set(a, [])
    byAnchor.get(a)!.push(v)
    const shop = v.liveAccountName?.trim() || '未知店铺'
    if (!byShop.has(shop)) byShop.set(shop, [])
    byShop.get(shop)!.push(v)
  }
  return {
    startDate,
    endDate,
    views,
    metrics,
    paymentGmv,
    orderCount,
    dealUsers,
    signedAmount,
    signedOrders,
    refundAmount,
    refundOrders,
    unassigned,
    byAnchor,
    byShop,
    validRemainingGmv: Math.max(0, paymentGmv - refundAmount),
  }
}

function summarizeOrders(label: string, period: Awaited<ReturnType<typeof loadBoardPeriod>>) {
  const aov = period.orderCount > 0 ? period.paymentGmv / period.orderCount : null
  const buyerAov = period.dealUsers > 0 ? period.paymentGmv / period.dealUsers : null
  return {
    label,
    startDate: period.startDate,
    endDate: period.endDate,
    paymentGmv: period.paymentGmv,
    receivedGmv: period.signedAmount,
    refundAmount: period.refundAmount,
    validRemainingGmv: period.validRemainingGmv,
    orderCount: period.orderCount,
    dealUsers: period.dealUsers,
    signedOrders: period.signedOrders,
    refundOrders: period.refundOrders,
    unassignedOrders: period.unassigned,
    aov,
    buyerAov,
    refundOrderRate: rateObj(period.refundOrders, period.orderCount),
    refundAmountRate: rateObj(period.refundAmount, period.paymentGmv),
    signedOrderRate: rateObj(period.signedOrders, period.orderCount),
    signedAmountRate: rateObj(period.signedAmount, period.paymentGmv),
  }
}

function gmvDecomposition(cur: { paymentGmv: number; orderCount: number }, prev: { paymentGmv: number; orderCount: number }) {
  const aovCur = cur.orderCount > 0 ? cur.paymentGmv / cur.orderCount : 0
  const aovPrev = prev.orderCount > 0 ? prev.paymentGmv / prev.orderCount : 0
  const paymentGmvChange = cur.paymentGmv - prev.paymentGmv
  const orderCountChange = cur.orderCount - prev.orderCount
  const aovChange = aovCur - aovPrev
  return {
    paymentGmvChange,
    orderCountChange,
    aovChange,
    orderCountEffect: orderCountChange * aovPrev,
    aovEffect: aovChange * cur.orderCount,
  }
}

export async function buildBusinessAiAnalysisExport(params?: { asOfDate?: string }) {
  const asOf = params?.asOfDate ?? formatDateKeyShanghai(new Date())
  const thisMonthStart = `${asOf.slice(0, 7)}-01`
  const thisMonthSameDayPrev = shiftMonthSameDay(asOf, -1)
  const lastMonthStart = shiftMonthSameDay(thisMonthStart, -1)

  const last7End = asOf
  const last7Start = addDays(asOf, -6)
  const prev7End = addDays(last7Start, -1)
  const prev7Start = addDays(prev7End, -6)

  const d30Start = addDays(asOf, -29)
  const d60Start = addDays(asOf, -59)

  const [
    periodThisMonthToDate,
    periodLastMonthSameDays,
    periodLast7,
    periodPrev7,
    period30,
    period60,
  ] = await Promise.all([
    loadBoardPeriod(thisMonthStart, asOf),
    loadBoardPeriod(lastMonthStart, thisMonthSameDayPrev),
    loadBoardPeriod(last7Start, last7End),
    loadBoardPeriod(prev7Start, prev7End),
    loadBoardPeriod(d30Start, asOf),
    loadBoardPeriod(d60Start, asOf),
  ])

  const sessionStart = '2026-06-01'
  const sessionsDb = await prisma.xhsRawLiveSession.findMany({
    where: {
      startTime: {
        gte: new Date(`${sessionStart}T00:00:00+08:00`),
        lt: new Date(`${addDays(asOf, 1)}T00:00:00+08:00`),
      },
    },
    orderBy: { startTime: 'asc' },
  })

  const sessionMetrics = sessionsDb.map((s) =>
    extractSessionMetrics({
      id: s.id,
      liveId: s.liveId,
      liveName: s.liveName,
      liveAccountId: s.liveAccountId,
      liveAccountName: s.liveAccountName,
      startTime: s.startTime,
      endTime: s.endTime,
      anchorName: s.anchorName,
      rawJson: s.rawJson,
    }),
  )

  // 复用经营日报 canonical 排班/场次归属（禁止自造主播匹配）
  {
    const scheduleCache = new Map<string, Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>>()
    for (let i = 0; i < sessionMetrics.length; i++) {
      const s = sessionMetrics[i]!
      const db = sessionsDb[i]!
      if (!s.startTime) continue
      const dateKey = formatDateKeyShanghai(new Date(s.startTime))
      let table = scheduleCache.get(dateKey)
      if (!table) {
        table = await getEffectiveScheduleTableForDate(dateKey)
        scheduleCache.set(dateKey, table)
      }
      const startIso = formatDateTimeShanghai(db.startTime ?? new Date(s.startTime))
      const endIso = db.endTime
        ? formatDateTimeShanghai(db.endTime)
        : formatDateTimeShanghai(
            new Date((db.startTime ?? new Date(s.startTime)).getTime() + Math.max(1, s.durationHours) * 3600000),
          )
      const durationMinutes = Math.max(1, Math.round(s.durationHours * 60))
      const brief: AnchorLiveSessionBrief = {
        liveId: s.sessionId,
        liveName: s.title ?? s.shopName ?? '',
        startTime: startIso,
        endTime: endIso,
        durationMinutes,
        durationText: formatLiveDurationMinutes(durationMinutes),
        sourceShopName: s.shopName ?? undefined,
        viewSessionCount: null,
        joinUserCount: null,
        avgOnlineUserCount: null,
        avgViewDurationSeconds: null,
        newFollowerCount: null,
        dealUserCount: null,
        coverClickRate: null,
        stay60sUserCount: null,
        impressionCount: null,
        viewPayRate: null,
      }
      const segments = matchLiveSessionToScheduleSegments(brief, table.rows)
      s.canonicalAnchorName = pickPrimaryCanonicalAnchorName(segments)
    }
  }

  const sessionsIn = (start: string, end: string) =>
    sessionMetrics.filter((s) => {
      if (!s.startTime) return false
      const d = formatDateKeyShanghai(new Date(s.startTime))
      return d >= start && d <= end
    })

  function sessionAgg(list: typeof sessionMetrics) {
    const paymentGmv = list.reduce((a, s) => a + s.paymentGmv, 0)
    const hours = list.reduce((a, s) => a + s.durationHours, 0)
    const dealOrders = list.reduce((a, s) => a + s.dealOrders, 0)
    const dealUsers = list.reduce((a, s) => a + s.dealUsers, 0)
    const viewUv = list.reduce((a, s) => a + s.viewUv, 0)
    const impression = list.reduce((a, s) => a + (s.impressionCnt || 0), 0)
    const clicks = list.reduce((a, s) => a + (s.goodsClickUsers || 0), 0)
    return {
      sessionCount: list.length,
      totalLiveHours: Number(hours.toFixed(2)),
      paymentGmv: Number(paymentGmv.toFixed(2)),
      dealOrders,
      dealUsers,
      viewUv,
      impressionCnt: impression,
      goodsClickUsers: clicks,
      avgGmvPerSession: list.length ? paymentGmv / list.length : null,
      gmvPerHour: hours > 0 ? paymentGmv / hours : null,
      avgViewUvPerSession: list.length ? viewUv / list.length : null,
      clickToDealRate: rateObj(dealUsers, clicks),
      viewDealRate: rateObj(dealUsers, viewUv),
    }
  }

  const curSessions = sessionsIn(thisMonthStart, asOf)
  const prevSessions = sessionsIn(lastMonthStart, thisMonthSameDayPrev)

  // weekday stats (30/60/all)
  function weekdayBlock(start: string, end: string) {
    const days = eachDayInShanghaiRange(start, end)
    const buckets = Array.from({ length: 7 }, (_, weekday) => {
      const dayKeys = days.filter((d) => weekdayShanghai(d) === weekday)
      const sess = sessionMetrics.filter((s) => {
        if (!s.startTime) return false
        const d = formatDateKeyShanghai(new Date(s.startTime))
        return dayKeys.includes(d)
      })
      const orders = period60.views.filter((v) => {
        if (!v.orderedAt) return false
        const d = formatDateKeyShanghai(new Date(v.orderedAt))
        return dayKeys.includes(d) && d >= start && d <= end
      })
      // Use sessions for GMV when available; also order pay GMV for signed metrics
      const payGmv = orders.reduce((a, v) => a + (v.paymentBaseCent ?? 0), 0) / 100
      const signed = orders.reduce((a, v) => a + (v.actualSignedAmountCent ?? 0) / 100, 0)
      const refund = orders.reduce((a, v) => a + (v.returnAmountCent ?? 0) / 100, 0)
      const hours = sess.reduce((a, s) => a + s.durationHours, 0)
      return {
        weekday,
        weekdayLabel: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekday],
        sampleDays: dayKeys.length,
        totalGmv: Number(payGmv.toFixed(2)),
        dailyAvgGmv: dayKeys.length ? payGmv / dayKeys.length : null,
        receivedGmv: Number(signed.toFixed(2)),
        validRemainingGmv: Number(Math.max(0, payGmv - refund).toFixed(2)),
        gmvPerHour: hours > 0 ? payGmv / hours : null,
        avgGmvPerSession: sess.length ? sess.reduce((a, s) => a + s.paymentGmv, 0) / sess.length : null,
        impression: sess.reduce((a, s) => a + (s.impressionCnt || 0), 0),
        viewUv: sess.reduce((a, s) => a + s.viewUv, 0),
        clickToDealRate: rateObj(
          sess.reduce((a, s) => a + s.dealUsers, 0),
          sess.reduce((a, s) => a + (s.goodsClickUsers || 0), 0),
        ),
        refundRate: rateObj(refund, payGmv),
        signedRate: rateObj(signed, payGmv),
        sessionCount: sess.length,
      }
    })
    return buckets
  }

  const anomalies: Array<Record<string, unknown>> = []
  for (const s of [...curSessions, ...prevSessions]) {
    if (s.paymentGmv <= 0 && s.dealOrders <= 0) {
      anomalies.push({ type: 'zero_deal', sessionId: s.sessionId, shopName: s.shopName, startTime: s.startTime, paymentGmv: s.paymentGmv, viewUv: s.viewUv })
    }
    if ((s.impressionCnt || 0) >= 3000 && s.dealOrders === 0) {
      anomalies.push({ type: 'high_impression_zero_deal', sessionId: s.sessionId, shopName: s.shopName, impressionCnt: s.impressionCnt, dealOrders: 0 })
    }
    if ((s.goodsClickUsers || 0) >= 20 && s.dealOrders <= 1) {
      anomalies.push({ type: 'high_click_low_deal', sessionId: s.sessionId, shopName: s.shopName, goodsClickUsers: s.goodsClickUsers, dealOrders: s.dealOrders })
    }
    if (s.paymentGmv >= 5000 && s.refundAmount / Math.max(s.paymentGmv, 1) >= 0.35) {
      anomalies.push({ type: 'high_gmv_high_refund', sessionId: s.sessionId, paymentGmv: s.paymentGmv, refundAmount: s.refundAmount, refundRate: s.refundAmount / s.paymentGmv })
    }
  }
  const topGmv = [...sessionMetrics].sort((a, b) => b.paymentGmv - a.paymentGmv).slice(0, 5)
  const topRemain = [...sessionMetrics]
    .map((s) => ({ ...s, remain: s.paymentGmv - s.refundAmount }))
    .sort((a, b) => b.remain - a.remain)
    .slice(0, 5)

  const cookieHealth = await Promise.all(
    GOOD_REVIEW_SHOPS.filter((s) => s.shopKey !== 'xiangyu').map(async (s) => {
      const { resolveOfficialShopAccountForStatus } = await import('./official-shop-account.service')
      const row = await resolveOfficialShopAccountForStatus(s.shopKey)
      return {
        shopKey: s.shopKey,
        shopName: s.shopName,
        cookieStatus: row?.cookieStatus ?? 'unknown',
        lastError: row?.cookieLastErrorMessage ?? null,
        lastFailedApi: row?.cookieLastFailedApi ?? null,
        lastSyncSuccessAt: row?.lastSyncSuccessAt?.toISOString() ?? null,
      }
    }),
  )

  const historyBackfillDone = (await getSetting('liveReviewHistoryBackfillDone')) === '1'
  const withReview = sessionMetrics.filter((s) => s.traffic != null || s.overview != null).length
  const withNotes = sessionMetrics.filter((s) => s.noteDetailAvailable).length

  const overallCur = summarizeOrders('本月同期', periodThisMonthToDate)
  const overallPrev = summarizeOrders('上月同期', periodLastMonthSameDays)
  const sessCur = sessionAgg(curSessions)
  const sessPrev = sessionAgg(prevSessions)

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      asOfDate: asOf,
      timezone: 'Asia/Shanghai',
      purpose: 'ChatGPT business analysis export — facts only, no coaching conclusions',
      definitions: {
        paymentGmv: '支付GMV：区间内经营缓存 views.paymentBaseCent 合计（元）',
        receivedGmv: '签收GMV：actualSignedAmount（已完成/交易完成口径）',
        refundAmount: '退款金额：经营指标 refundAmount',
        validRemainingGmv: '支付GMV - 已退款金额（近似留存，非财务结算）',
        orderAttribution: 'canonical attribution（下单时间匹配排班/场次）；未改写',
        sessionSource: 'XhsRawLiveSession.rawJson + live_review 补齐字段',
        canonicalAnchorName: '经营日报 matchLiveSessionToScheduleSegments 主段主播；非自造匹配',
      },
      sourceTask: {
        scheduler: 'apps/server/src/services/scheduler.service.ts',
        intervalMinutes: 180,
        liveReviewEnrich: 'xhs-live-review-enrich.service.ts (hooked after live list sync)',
      },
    },
    dataQuality: {
      historyBackfillDone,
      shops: cookieHealth,
      sessionCount: sessionMetrics.length,
      sessionsWithLiveReview: withReview,
      sessionsWithNoteDetail: withNotes,
      orderCountThisMonthToDate: periodThisMonthToDate.orderCount,
      orderCountLastMonthSameDays: periodLastMonthSameDays.orderCount,
      unassignedOrdersThisMonthToDate: periodThisMonthToDate.unassigned,
      missingCapabilities: [
        withNotes === 0 ? 'note_detail_sparse_or_unavailable' : null,
        withReview < sessionMetrics.length * 0.3 ? 'live_review_enrich_incomplete' : null,
      ].filter(Boolean),
    },
    comparisonPeriods: {
      monthToDateSameDays: {
        current: { start: thisMonthStart, end: asOf },
        previous: { start: lastMonthStart, end: thisMonthSameDayPrev },
        note: '严禁用完整上月对比本月截至日；此处为同天数对比',
      },
      last7vsPrev7: {
        current: { start: last7Start, end: last7End },
        previous: { start: prev7Start, end: prev7End },
      },
      last30: { start: d30Start, end: asOf },
      last60: { start: d60Start, end: asOf },
    },
    overall: {
      monthToDateSameDays: {
        current: { ...overallCur, sessions: sessCur },
        previous: { ...overallPrev, sessions: sessPrev },
        gmvDecomposition: gmvDecomposition(
          { paymentGmv: overallCur.paymentGmv, orderCount: overallCur.orderCount },
          { paymentGmv: overallPrev.paymentGmv, orderCount: overallPrev.orderCount },
        ),
        sessionDecomposition: gmvDecomposition(
          { paymentGmv: sessCur.paymentGmv, orderCount: sessCur.dealOrders },
          { paymentGmv: sessPrev.paymentGmv, orderCount: sessPrev.dealOrders },
        ),
      },
      last7vsPrev7: {
        current: summarizeOrders('最近7天', periodLast7),
        previous: summarizeOrders('前7天', periodPrev7),
        gmvDecomposition: gmvDecomposition(
          {
            paymentGmv: periodLast7.paymentGmv,
            orderCount: periodLast7.orderCount,
          },
          {
            paymentGmv: periodPrev7.paymentGmv,
            orderCount: periodPrev7.orderCount,
          },
        ),
      },
    },
    anchors: unionMapKeys(
      periodThisMonthToDate.byAnchor as Map<string, unknown>,
      periodLastMonthSameDays.byAnchor as Map<string, unknown>,
    ).map((name) => {
      const views = periodThisMonthToDate.byAnchor.get(name) ?? []
      const prevViews = periodLastMonthSameDays.byAnchor.get(name) ?? []
      const m = calculateBusinessMetrics(views)
      const pay = views.reduce((s, v) => s + (v.paymentBaseCent ?? 0), 0) / 100
      const prevPay = prevViews.reduce((s, v) => s + (v.paymentBaseCent ?? 0), 0) / 100
      const prevM = calculateBusinessMetrics(prevViews)
      return {
        anchorName: name,
        current: {
          paymentGmv: pay,
          receivedGmv: m.actualSignedAmount,
          refundAmount: m.refundAmount,
          orderCount: views.length,
          dealUsers: new Set(views.map((v) => v.buyerKey).filter(Boolean)).size,
        },
        previousSameDays: {
          paymentGmv: prevPay,
          receivedGmv: prevM.actualSignedAmount,
          refundAmount: prevM.refundAmount,
          orderCount: prevViews.length,
          dealUsers: new Set(prevViews.map((v) => v.buyerKey).filter(Boolean)).size,
        },
        gmvDecomposition: gmvDecomposition(
          { paymentGmv: pay, orderCount: views.length },
          { paymentGmv: prevPay, orderCount: prevViews.length },
        ),
      }
    }),
    shops: unionMapKeys(
      periodThisMonthToDate.byShop as Map<string, unknown>,
      periodLastMonthSameDays.byShop as Map<string, unknown>,
    ).map((name) => {
      const views = periodThisMonthToDate.byShop.get(name) ?? []
      const prevViews = periodLastMonthSameDays.byShop.get(name) ?? []
      const m = calculateBusinessMetrics(views)
      const pay = views.reduce((s, v) => s + (v.paymentBaseCent ?? 0), 0) / 100
      const prevPay = prevViews.reduce((s, v) => s + (v.paymentBaseCent ?? 0), 0) / 100
      const shopSessions = curSessions.filter((s) => s.shopName === name)
      const prevShopSessions = prevSessions.filter((s) => s.shopName === name)
      return {
        shopName: name,
        shopKey: resolveGoodReviewShopKey(name),
        current: {
          paymentGmv: pay,
          receivedGmv: m.actualSignedAmount,
          refundAmount: m.refundAmount,
          orderCount: views.length,
          sessions: sessionAgg(shopSessions),
        },
        previousSameDays: {
          paymentGmv: prevPay,
          orderCount: prevViews.length,
          sessions: sessionAgg(prevShopSessions),
        },
        gmvDecomposition: gmvDecomposition(
          { paymentGmv: pay, orderCount: views.length },
          { paymentGmv: prevPay, orderCount: prevViews.length },
        ),
      }
    }),
    sessions: sessionMetrics,
    daily: eachDayInShanghaiRange(d30Start, asOf).map((day) => {
      const daySessions = sessionsIn(day, day)
      const dayOrders = period30.views.filter((v) => {
        if (!v.orderedAt) return false
        return formatDateKeyShanghai(new Date(v.orderedAt)) === day
      })
      const pay = dayOrders.reduce((a, v) => a + (v.paymentBaseCent ?? 0), 0) / 100
      return {
        date: day,
        weekday: weekdayShanghai(day),
        paymentGmv: Number(pay.toFixed(2)),
        orderCount: dayOrders.length,
        sessions: sessionAgg(daySessions),
      }
    }),
    weekday: {
      last30: weekdayBlock(d30Start, asOf),
      last60: weekdayBlock(d60Start, asOf),
      allAvailable: weekdayBlock(sessionStart, asOf),
    },
    orders: {
      monthToDateSameDays: overallCur,
      lastMonthSameDays: overallPrev,
    },
    logistics: {
      note: '签收/在途口径来自经营指标 actualSignedAmount / awaitingSignCompletion（若缓存提供）',
      currentSignedAmount: periodThisMonthToDate.signedAmount,
      currentSignedOrders: periodThisMonthToDate.signedOrders,
      awaitingSignCompletionAmount: periodThisMonthToDate.metrics.awaitingSignCompletionAmount ?? null,
    },
    afterSales: {
      refundAmount: periodThisMonthToDate.refundAmount,
      refundOrders: periodThisMonthToDate.refundOrders,
      refundOrderRate: rateObj(periodThisMonthToDate.refundOrders, periodThisMonthToDate.orderCount),
      refundAmountRate: rateObj(periodThisMonthToDate.refundAmount, periodThisMonthToDate.paymentGmv),
    },
    notes: sessionMetrics.flatMap((s) =>
      (s.notes || []).map((n) => ({
        ...n,
        sessionId: s.sessionId,
        shopKey: s.shopKey,
        shopName: s.shopName,
        sessionStartTime: s.startTime,
      })),
    ),
    coverTraffic: sessionMetrics.flatMap((s) =>
      (s.coverTraffic || []).map((c) => ({
        ...c,
        sessionId: s.sessionId,
        shopName: s.shopName,
        sessionStartTime: s.startTime,
      })),
    ),
    anomalies: {
      topPaymentGmvSessions: topGmv.map((s) => ({
        type: 'top_payment_gmv',
        sessionId: s.sessionId,
        shopName: s.shopName,
        paymentGmv: s.paymentGmv,
        startTime: s.startTime,
      })),
      topRemainingGmvSessions: topRemain.map((s) => ({
        type: 'top_remaining_gmv',
        sessionId: s.sessionId,
        shopName: s.shopName,
        remainingGmv: s.remain,
        paymentGmv: s.paymentGmv,
        refundAmount: s.refundAmount,
        startTime: s.startTime,
      })),
      flagged: anomalies.slice(0, 80),
    },
  }
}
