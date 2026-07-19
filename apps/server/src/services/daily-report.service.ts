import type { AnchorConfig, AnalyzedOrderView } from '../types/analysis'
import type { UserRole } from '../types/roles'
import {
  findYifanManualSystemAnchor,
  getAnchorConfigSync,
  isOfflineOnlyAnchor,
} from './anchor.service'
import { splitGmvByDealSource } from './offline-deal.service'
import { isOfflineDealView } from '../utils/offline-deal-view.util'
import { rangeIncludesOfflineGmvSurface } from '../config/offline-gmv.constants'
import { centToYuan } from '../utils/money'
import {
  filterViewsByAnchorSpec,
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from './board-scoped-views.service'
import {
  aggregateAnchorLiveSessionTraffic,
  sumNewFollowersByLiveAccountForRange,
  type AnchorLiveSessionBrief,
  type LiveRoomNewFollowerRow,
} from './anchor-live-sessions.service'
import {
  getAssignedSessionsForAnchor,
  resolveDailyReportLiveSessionAssignments,
  sumUniqueDailyReportLiveDurationMinutes,
  type DailyReportLiveSessionAssignment,
} from './daily-report-live-sessions.service'
import {
  ANCHOR_SESSION_DISPLAY_FROM_0613,
  isReportDateOnOrAfterShopSessionCutoff,
  resolveDailyReportAnchorsForDate,
  resolveDailyReportAnchorsForDateAsync,
  shouldPadEmptyAnchorSlot,
} from './anchor-performance-attribution.service'
import { remapViewsWithScheduleOverlay } from './anchor-schedule-attribution.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { ensureManualAnchorOverrideCache } from './order-anchor-manual-override.service'
import {
  countDailyReportOrders,
  listDailyReportShippedOrders,
  roundMinutes,
  roundMoneyYuan,
  roundYuan,
  safeDivide,
  safeRatioPercent,
  sumDailyReportShippedFromViews,
  type DailyReportShippedOrderLine,
} from './daily-report-order.util'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { buildDailyReportLiveScheduleFields } from './daily-report-live-schedule-match.service'
import {
  buildDisplayLivePeriodText,
  buildLiveSessionDisplaySummary,
  collapseDailyReportDisplaySessions,
} from './daily-report-session-display.util'
import {
  resolveFallbackSessionDisplay,
  type AnchorAttendanceStatusPayload,
} from '../utils/anchor-attendance-status.util'
import { aggregateAnchorLeaderboard } from './board-metrics.service'
import { enrichAnchorLeaderboardWithLateStatus } from './anchor-late-enrichment.service'
import { enrichAnchorLeaderboardWithTrend, buildLeaderboardRowIntradayTrend, resolveAnchorTrendMode, type AnchorTrend } from './anchor-card-trend.service'
import { ensureAnchorPerformanceLeaderboardSlotsWithTemporary } from './anchor-performance-attribution.service'
import {
  isRealtimeBoardPreset,
  resolveBoardPresetForSingleDay,
} from '../utils/board-realtime-refresh.util'
import { normalizeShopLabel, normalizeShopName } from '../utils/shop-name-normalize.util'
import {
  buildDailyReportImageSessionsForAnchor,
  type DailyReportImageSession,
} from './daily-report-image-session'

export type {
  DailyReportImageSession,
  DailyReportImageSessionStatus,
} from './daily-report-image-session'
export {
  buildDailyReportImageSessionsForAnchor,
  resolveDailyReportImageSessionStatus,
} from './daily-report-image-session'

const NO_LIVE_SESSION_TEXT = '未读取到直播场次'

const EMPTY_SCHEDULE_ATTENDANCE: AnchorAttendanceStatusPayload = {
  hasSchedule: false,
  hasActualStartTime: false,
  hasActualEndTime: false,
  scheduledStartAt: null,
  scheduledEndAt: null,
  scheduledPeriodText: null,
  actualStartAt: null,
  actualStartText: null,
  actualEndAt: null,
  actualEndText: null,
  sessionLabel: '',
  shopName: '—',
  displaySessionLabel: '—',
}

function isUnassignedAnchorView(v: AnalyzedOrderView): boolean {
  const name = String(v.anchorName ?? '').trim()
  return name === '未归属' || v.attributionType === 'unassigned'
}

export interface DailyReportAnchorRow extends AnchorAttendanceStatusPayload {
  anchorId?: string
  systemKey?: string | null
  attributionMode?: string | null
  /** 主播主题色（优先 Anchor.color） */
  color?: string | null
  anchorName: string
  sessionLabel: string
  shopName: string
  livePeriodText: string
  liveTimeRange: string
  liveStartTime: string | null
  liveEndTime: string | null
  scheduleTimeRange: string | null
  scheduleMatched: boolean
  scheduleMatchReason: string | null
  liveDurationText: string
  /** 同一展示班次内平台多段记录时的辅助说明，如「平台记录2段」 */
  liveSessionPlatformNote?: string | null
  liveDurationMinutes: number
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  /** 真实发货订单明细（已剔除售后/关闭/取消） */
  shippedOrders: DailyReportShippedOrderLine[]
  avgOrderAmountYuan: number | null
  hourlyAmountYuan: number | null
  dealDensityMinutes: number | null
  amountRatio: number | null
  viewSessionCount: number | null
  joinUserCount: number | null
  avgOnlineUserCount: number | null
  avgViewDurationSeconds: number | null
  newFollowerCount: number | null
  dealUserCount: number | null
  dealConversionRate: number | null
  newFollowerRate: number | null
  /** 封面点击率（0–1） */
  coverClickRate: number | null
  /** 60s 停留人数 */
  stay60sUserCount: number | null
  /** 曝光次数 */
  impressionCount: number | null
  /** 观看支付率（0–1） */
  viewPayRate: number | null
  /** 临时试播主播 */
  isTemporaryAnchor?: boolean
  temporaryAnchorKey?: string | null
  /** 与主播卡片「本期销售额」一致，供走势对账 */
  gmvYuan?: number
  /** 与主播业绩页 anchorLeaderboard.trend 同源 */
  trend?: AnchorTrend
}

export interface DailyReportPayload {
  dateLabel: string
  title: string
  startDate: string
  endDate: string
  summary: {
    totalShippedAmountYuan: number
    totalSoldOrderCount: number
    totalInvalidOrderCount: number
    /** 全店真实发货订单明细 */
    shippedOrders: DailyReportShippedOrderLine[]
    totalLiveDurationMinutes: number
    assignedLiveDurationMinutes: number
    unassignedLiveDurationMinutes: number
    unassignedLiveSessionCount: number
    liveSessionAttributionNote: string | null
    unassignedShippedOrderCount?: number
    unassignedShippedNote?: string | null
    overallHourlyAmountYuan: number | null
    liveRoomNewFollowers: LiveRoomNewFollowerRow[]
    totalNewFollowerCount: number
    /** 线上支付 GMV（不含线下） */
    onlineGmvYuan?: number
    /** 线下支付 GMV（逸凡等），有出单时写入日报 */
    offlineGmvYuan?: number
    offlineDealCount?: number
    /** 线上 + 线下支付 GMV */
    totalGmvYuan?: number
  }
  anchors: DailyReportAnchorRow[]
  /**
   * 日报长图专用：按「展示班次」展开的场次列表。
   * 无直播展示班次的店铺不会出现；同一店多场 → 多条。
   */
  imageSessions?: DailyReportImageSession[]
}

/** 线下成交明细行（复用 shippedOrders 结构，前端按 systemKey 改文案） */
function listOfflineDealOrderLines(
  views: AnalyzedOrderView[],
  anchorName?: string,
): DailyReportShippedOrderLine[] {
  const lines: DailyReportShippedOrderLine[] = []
  for (const v of views) {
    if (!isOfflineDealView(v) || !v.includedInGmv) continue
    if ((v.paymentBaseCent ?? 0) <= 0) continue
    const orderNo = String(v.offlineDealKey || v.orderId || '').trim()
    if (!orderNo) continue
    const title =
      String(v.reasonText || '').trim() ||
      String(v.buyerDisplayName || v.buyerNickname || '').trim() ||
      '线下成交'
    const resolvedAnchorName = (anchorName ?? v.anchorName ?? '').trim()
    lines.push({
      orderNo,
      productTitle: title,
      amountYuan: roundMoneyYuan(centToYuan(v.paymentBaseCent)),
      ...(resolvedAnchorName ? { anchorName: resolvedAnchorName } : {}),
    })
  }
  return lines.sort((a, b) => a.productTitle.localeCompare(b.productTitle, 'zh-CN'))
}

function formatDailyReportDateLabel(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim())
  if (!m) return dateKey
  return `${Number(m[2])}.${Number(m[3])}`
}

function resolveSessionLabel(config: AnchorConfig, anchorId: string): string {
  const rule = config.timeRules.find((r) => r.enabled && r.anchorId === anchorId)
  if (!rule) return '场次'
  const startHour = Number(rule.startTime.split(':')[0] ?? 0)
  if (startHour >= 22) return '夜场'
  if (startHour >= 18) return '晚场'
  if (startHour >= 12) return '午场'
  return '早场'
}

function pickShopNameFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const keys = ['shopName', 'shop_name', 'sellerShopName', 'seller_shop_name', 'storeName', 'store_name']
  for (const k of keys) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function resolveAnchorShopName(
  views: ReturnType<typeof attachRawByMatchToViews>,
  sessions: AnchorLiveSessionBrief[],
): string {
  const counts = new Map<string, number>()
  for (const view of views) {
    const liveAccountName = (view.liveAccountName ?? '').trim()
    if (liveAccountName && liveAccountName !== '—') {
      counts.set(liveAccountName, (counts.get(liveAccountName) ?? 0) + 1)
    }
    const shopName = pickShopNameFromRaw(view.raw)
    if (shopName && shopName !== '—') {
      counts.set(shopName, (counts.get(shopName) ?? 0) + 1)
    }
  }
  if (counts.size > 0) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  }
  for (const session of sessions) {
    const liveName = (session.liveName ?? '').trim()
    if (liveName && liveName !== '—') return liveName
  }
  return ''
}

function formatSessionLabelWithShop(sessionLabel: string, shopName: string): string {
  if (!shopName) return sessionLabel
  return `${sessionLabel}·${shopName}`
}

function buildLiveAccountAnchorNamesMap(
  anchorRows: DailyReportAnchorRow[],
  liveAssignment: DailyReportLiveSessionAssignment,
): Map<string, string[]> {
  const map = new Map<string, Set<string>>()

  const add = (liveAccount: string, anchorName: string) => {
    const account = liveAccount.trim()
    const name = anchorName.trim()
    if (!account || !name) return
    if (!map.has(account)) map.set(account, new Set())
    map.get(account)!.add(name)
  }

  for (const row of anchorRows) {
    if (row.shopName) add(row.shopName, row.anchorName)
  }

  for (const [anchorName, sessions] of liveAssignment.byAnchor.entries()) {
    for (const session of sessions) {
      add(session.sourceShopName || session.liveName || '', anchorName)
    }
  }

  return new Map(
    [...map.entries()].map(([account, names]) => [
      account,
      [...names].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    ]),
  )
}

function resolveAnchorNamesForLiveAccount(
  liveAccountName: string,
  accountMap: Map<string, string[]>,
): string[] {
  const trimmed = liveAccountName.trim()
  if (!trimmed) return []

  const exact = accountMap.get(trimmed)
  if (exact?.length) return exact

  const canonical = normalizeShopName(trimmed)
  if (canonical) {
    for (const [key, names] of accountMap.entries()) {
      if (normalizeShopName(key) === canonical) {
        return names
      }
    }
  }

  const normalizedLabel = normalizeShopLabel(trimmed).toLowerCase()
  if (normalizedLabel) {
    for (const [key, names] of accountMap.entries()) {
      if (normalizeShopLabel(key).toLowerCase() === normalizedLabel) {
        return names
      }
    }
  }

  return []
}

function enrichLiveRoomNewFollowersWithAnchorNames(
  rows: LiveRoomNewFollowerRow[],
  anchorRows: DailyReportAnchorRow[],
  liveAssignment: DailyReportLiveSessionAssignment,
): LiveRoomNewFollowerRow[] {
  const accountMap = buildLiveAccountAnchorNamesMap(anchorRows, liveAssignment)
  return rows.map((row) => ({
    ...row,
    anchorNames: resolveAnchorNamesForLiveAccount(row.liveAccountName, accountMap),
  }))
}

function buildAnchorRow(params: {
  config: AnchorConfig
  anchorId: string
  anchorName: string
  shopName: string
  sessionLabel?: string
  reportDate: string
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  shippedOrders: DailyReportShippedOrderLine[]
  sessions: AnchorLiveSessionBrief[]
  totalShippedAmountYuan: number
  scheduleAttendance: AnchorAttendanceStatusPayload
  liveTimeRange: string
  liveStartTime: string | null
  liveEndTime: string | null
  scheduleTimeRange: string | null
  scheduleMatched: boolean
  scheduleMatchReason: string | null
  isTemporaryAnchor?: boolean
  temporaryAnchorKey?: string | null
  colorOverride?: string | null
}): DailyReportAnchorRow {
  const liveDurationMinutes = params.sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  const liveHours = safeDivide(liveDurationMinutes, 60)
  const traffic =
    params.sessions.length > 0 ? aggregateAnchorLiveSessionTraffic(params.sessions) : null
  const hasRealSessions = params.sessions.length > 0
  const displayGroups = hasRealSessions
    ? collapseDailyReportDisplaySessions(params.sessions)
    : []
  const displaySummary = buildLiveSessionDisplaySummary(displayGroups)
  const displayPeriodText = hasRealSessions
    ? buildDisplayLivePeriodText(displayGroups)
    : '—'
  const sessionLabel =
    params.scheduleAttendance.displaySessionLabel ||
    params.sessionLabel ||
    (hasRealSessions
      ? resolveFallbackSessionDisplay({
          fallbackSessionLabel: params.sessionLabel,
          fallbackShopName: params.shopName,
          timeRuleSessionLabel: resolveSessionLabel(params.config, params.anchorId),
          dateKey: params.reportDate,
        }).displaySessionLabel
      : '')
  const shopName =
    params.scheduleAttendance.shopName ||
    params.shopName ||
    (hasRealSessions
      ? resolveFallbackSessionDisplay({
          fallbackSessionLabel: params.sessionLabel,
          fallbackShopName: params.shopName,
          timeRuleSessionLabel: resolveSessionLabel(params.config, params.anchorId),
          dateKey: params.reportDate,
        }).shopName
      : '')
  const liveDurationText = hasRealSessions ? displaySummary.liveDurationText : '—'
  const liveTimeRange = hasRealSessions
    ? displayPeriodText.replace(/~/g, '–')
    : NO_LIVE_SESSION_TEXT
  const meta = params.config.anchors.find((a) => a.id === params.anchorId)
  return {
    anchorId: params.anchorId,
    systemKey: meta?.systemKey ?? null,
    attributionMode: meta?.attributionMode ?? null,
    color: params.colorOverride ?? meta?.color ?? null,
    anchorName: params.anchorName,
    isTemporaryAnchor: Boolean(params.isTemporaryAnchor),
    temporaryAnchorKey: params.temporaryAnchorKey ?? null,
    livePeriodText: hasRealSessions ? displayPeriodText : '—',
    liveTimeRange,
    liveStartTime: hasRealSessions ? params.liveStartTime : null,
    liveEndTime: hasRealSessions ? params.liveEndTime : null,
    scheduleTimeRange: params.scheduleTimeRange,
    scheduleMatched: params.scheduleMatched,
    scheduleMatchReason: params.scheduleMatchReason,
    liveDurationText,
    liveSessionPlatformNote: displaySummary.platformRecordNote,
    liveDurationMinutes,
    shippedAmountYuan: params.shippedAmountYuan,
    soldOrderCount: params.soldOrderCount,
    invalidOrderCount: params.invalidOrderCount,
    shippedOrders: params.shippedOrders,
    avgOrderAmountYuan: roundMoneyYuan(
      safeDivide(params.shippedAmountYuan, params.soldOrderCount) ?? 0,
    ),
    hourlyAmountYuan: roundYuan(
      liveHours != null ? safeDivide(params.shippedAmountYuan, liveHours) : null,
    ),
    dealDensityMinutes: roundMinutes(
      safeDivide(liveDurationMinutes, params.soldOrderCount),
    ),
    amountRatio: safeRatioPercent(params.shippedAmountYuan, params.totalShippedAmountYuan),
    viewSessionCount: traffic?.viewSessionCount ?? null,
    joinUserCount: traffic?.joinUserCount ?? null,
    avgOnlineUserCount: traffic?.avgOnlineUserCount ?? null,
    avgViewDurationSeconds: traffic?.avgViewDurationSeconds ?? null,
    newFollowerCount: traffic?.newFollowerCount ?? null,
    dealUserCount: traffic?.dealUserCount ?? null,
    dealConversionRate: traffic?.dealConversionRate ?? null,
    newFollowerRate: traffic?.newFollowerRate ?? null,
    coverClickRate: traffic?.coverClickRate ?? null,
    stay60sUserCount: traffic?.stay60sUserCount ?? null,
    impressionCount: traffic?.impressionCount ?? null,
    viewPayRate: traffic?.viewPayRate ?? null,
    ...params.scheduleAttendance,
    sessionLabel,
    shopName,
  }
}

export async function buildDailyReport(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<DailyReportPayload> {
  const effectivePreset = resolveBoardPresetForSingleDay(params)
  const scoped = await getBoardScopedViewsForRange({
    ...params,
    preset: effectivePreset,
    forceRefresh: isRealtimeBoardPreset(effectivePreset),
  })
  await ensureManualAnchorOverrideCache()
  const config = getAnchorConfigSync()
  const anchorRows: DailyReportAnchorRow[] = []
  const useShopSessionRules = isReportDateOnOrAfterShopSessionCutoff(params.startDate)
  const remappedAll = (
    await remapViewsWithScheduleOverlay(attachRawByMatchToViews(scoped.views, scoped.rawByMatch))
  ).filter((v) => !isOfflineDealView(v))
  /**
   * 真实发货 / 直播指标仍只统计线上。
   * 线下成交单独汇总；有出单时追加逸凡卡片到日报图片。
   */
  const allPerformanceViewsWithOffline = await getAnchorPerformanceViews(
    scoped.views,
    scoped.rawByMatch,
  )
  const allPerformanceViews = allPerformanceViewsWithOffline.filter((v) => !isOfflineDealView(v))
  const gmvSplit = splitGmvByDealSource(allPerformanceViewsWithOffline)
  const showOfflineOnReport =
    rangeIncludesOfflineGmvSurface(params.startDate, params.endDate) && gmvSplit.offlineGmv > 0
  const storeWideShipped = sumDailyReportShippedFromViews(allPerformanceViews)
  const storeWideInvalid = countDailyReportOrders(allPerformanceViews).invalidOrderCount

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  // 打开昨日日报前补齐封面点击率 / 60s，降低「数据缺失」
  try {
    const { ensureLiveRealtimeMetricsForReportDate } = await import(
      './xhs-api-sync/xhs-live-realtime-metric.service'
    )
    await ensureLiveRealtimeMetricsForReportDate(params.startDate)
  } catch (err) {
    console.warn(
      '[daily-report] realtime metric ensure failed',
      err instanceof Error ? err.message : String(err),
    )
  }
  const liveAssignment = await resolveDailyReportLiveSessionAssignments(params.startDate)
  const orderNames = [
    ...new Set(
      remappedAll
        .map((v) => (v.anchorName ?? '').trim())
        .filter((n) => n && n !== '未归属'),
    ),
  ]
  const liveNames = [
    ...new Set(
      [...liveAssignment.byAnchor.keys()].map((n) => n.trim()).filter(Boolean),
    ),
  ]
  const reportAnchors = (
    await resolveDailyReportAnchorsForDateAsync(config, params.startDate, {
      orderAnchorNames: orderNames,
      liveSessionAnchorNames: liveNames,
    })
  ).filter((a) => !isOfflineOnlyAnchor({ systemKey: a.systemKey }))
  const usedScheduleRowIds = new Set<string>()
  /** 组装 imageSessions 用：主播 → 归属场次快照 */
  const sessionsByAnchorName = new Map<string, AnchorLiveSessionBrief[]>()
  for (const anchor of reportAnchors) {
    if (isOfflineOnlyAnchor({ systemKey: anchor.systemKey })) continue
    const performanceViewsRaw = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.isTemporaryAnchor ? undefined : anchor.anchorId,
      anchor.anchorName,
    )
    const performanceViews = performanceViewsRaw.filter((v) => !isOfflineDealView(v))
    const shipped = sumDailyReportShippedFromViews(performanceViews)
    const shippedAmountYuan = shipped.shippedAmountYuan
    const shippedOrders = listDailyReportShippedOrders(performanceViews, anchor.anchorName)

    const anchorAllViews = filterViewsByAnchorSpec(remappedAll, anchor.anchorId, anchor.anchorName)
    const { soldOrderCount } = shipped
    const { invalidOrderCount: invalidFromPerformance } = countDailyReportOrders(performanceViews)
    const fixedDisplay = useShopSessionRules
      ? ANCHOR_SESSION_DISPLAY_FROM_0613[anchor.anchorName]
      : undefined

    const sessions = getAssignedSessionsForAnchor(liveAssignment, anchor.anchorName)

    const liveSchedule = buildDailyReportLiveScheduleFields({
      anchorName: anchor.anchorName,
      allSessions: sessions,
      scheduleRows: scheduleTable.rows,
      usedScheduleRowIds,
    })

    const hasData =
      shippedAmountYuan > 0 ||
      soldOrderCount > 0 ||
      invalidFromPerformance > 0 ||
      sessions.length > 0 ||
      performanceViews.length > 0

    // 固定场次空行：仅在职有效日保留；已删除/离职后的新日期不展示空卡
    // 临时试播：有排班或直播场次也保留空行
    // 请假排班：保留空行以便日报图片打休假水印
    const cfgAnchor = config.anchors.find(
      (a) => a.id === anchor.anchorId || a.name === anchor.anchorName,
    )
    const hasLeaveSlot = scheduleTable.rows.some(
      (r) => r.enabled && r.isOnLeave && r.anchorName === anchor.anchorName,
    )
    const keepEmptySlot =
      Boolean(
        fixedDisplay &&
          shouldPadEmptyAnchorSlot(
            cfgAnchor ?? {
              enabled: true,
              effectiveFrom: anchor.effectiveFrom,
              effectiveTo: anchor.effectiveTo,
            },
            params.startDate,
          ),
      ) ||
      Boolean(
        anchor.isTemporaryAnchor &&
          (sessions.length > 0 ||
            scheduleTable.rows.some(
              (r) =>
                r.anchorName === anchor.anchorName ||
                (anchor.temporaryAnchorKey &&
                  (r as { temporaryAnchorKey?: string | null }).temporaryAnchorKey ===
                    anchor.temporaryAnchorKey),
            )),
      ) ||
      hasLeaveSlot
    if (!hasData && !keepEmptySlot) continue

    const shopNameHint =
      fixedDisplay?.shopName ?? resolveAnchorShopName(anchorAllViews, sessions)

    const scheduleAttendance = liveSchedule.scheduleAttendance

    const shopName =
      scheduleAttendance.shopName || liveSchedule.primaryScheduleRow?.shopName || shopNameHint

    sessionsByAnchorName.set(anchor.anchorName, sessions)

    anchorRows.push(
      buildAnchorRow({
        config,
        anchorId: anchor.anchorId,
        anchorName: anchor.anchorName,
        shopName,
        reportDate: params.startDate,
        sessionLabel: scheduleAttendance.hasSchedule
          ? scheduleAttendance.displaySessionLabel
          : fixedDisplay?.sessionLabel,
        shippedAmountYuan,
        soldOrderCount,
        invalidOrderCount: invalidFromPerformance,
        shippedOrders,
        sessions,
        totalShippedAmountYuan: 0,
        scheduleAttendance,
        liveTimeRange: liveSchedule.liveTimeRange,
        liveStartTime: liveSchedule.liveStartTime,
        isTemporaryAnchor: Boolean(anchor.isTemporaryAnchor),
        temporaryAnchorKey: anchor.temporaryAnchorKey ?? null,
        colorOverride: anchor.color ?? null,
        liveEndTime: liveSchedule.liveEndTime,
        scheduleTimeRange: liveSchedule.scheduleTimeRange,
        scheduleMatched: liveSchedule.scheduleMatched,
        scheduleMatchReason: liveSchedule.scheduleMatchReason,
      }),
    )
  }

  const unassignedPerformanceViews = allPerformanceViews.filter(isUnassignedAnchorView)
  const unassignedShipped = sumDailyReportShippedFromViews(unassignedPerformanceViews)
  const hasUnassignedAnchorRow = anchorRows.some((row) => row.anchorName === '未归属')
  if (
    !hasUnassignedAnchorRow &&
    (unassignedShipped.soldOrderCount > 0 ||
      unassignedShipped.shippedAmountYuan > 0 ||
      countDailyReportOrders(unassignedPerformanceViews).invalidOrderCount > 0)
  ) {
    const unassignedInvalid = countDailyReportOrders(unassignedPerformanceViews).invalidOrderCount
    anchorRows.push(
      buildAnchorRow({
        config,
        anchorId: 'unassigned',
        anchorName: '未归属',
        shopName: '—',
        reportDate: params.startDate,
        shippedAmountYuan: unassignedShipped.shippedAmountYuan,
        soldOrderCount: unassignedShipped.soldOrderCount,
        invalidOrderCount: unassignedInvalid,
        shippedOrders: listDailyReportShippedOrders(unassignedPerformanceViews, '未归属'),
        sessions: [],
        totalShippedAmountYuan: 0,
        scheduleAttendance: EMPTY_SCHEDULE_ATTENDANCE,
        liveTimeRange: NO_LIVE_SESSION_TEXT,
        liveStartTime: null,
        liveEndTime: null,
        scheduleTimeRange: null,
        scheduleMatched: false,
        scheduleMatchReason: null,
      }),
    )
  }

  const totalShippedAmountYuan = storeWideShipped.shippedAmountYuan
  for (const row of anchorRows) {
    row.amountRatio = safeRatioPercent(row.shippedAmountYuan, totalShippedAmountYuan)
  }

  const totalSoldOrderCount = storeWideShipped.soldOrderCount
  const totalInvalidOrderCount = storeWideInvalid
  let leaderboardRows = (await ensureAnchorPerformanceLeaderboardSlotsWithTemporary(
    aggregateAnchorLeaderboard(allPerformanceViews),
    params.startDate,
  )) as unknown as Array<Record<string, unknown>>
  leaderboardRows = await enrichAnchorLeaderboardWithLateStatus(leaderboardRows, {
    startDate: params.startDate,
    endDate: params.endDate,
    preset: isRealtimeBoardPreset(effectivePreset) ? effectivePreset : 'custom',
  })
  leaderboardRows = await enrichAnchorLeaderboardWithTrend(leaderboardRows, allPerformanceViews, {
    preset: isRealtimeBoardPreset(effectivePreset) ? effectivePreset : 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const trendByAnchor = new Map(leaderboardRows.map((r) => [String(r.anchorName ?? ''), r]))
  const trendMode = resolveAnchorTrendMode({
    preset: isRealtimeBoardPreset(effectivePreset) ? effectivePreset : 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
  })
  for (const row of anchorRows) {
    const lb = trendByAnchor.get(row.anchorName)
    row.gmvYuan = Number(lb?.gmv ?? lb?.totalGmv ?? 0)

    const mergedTrendRow: Record<string, unknown> = {
      ...(lb ?? {}),
      anchorName: row.anchorName,
      scheduledPeriodText:
        (lb?.scheduledPeriodText as string | undefined) ??
        (row.scheduleTimeRange ? row.scheduleTimeRange.replace(/-/g, '~') : null),
      liveTimeRange:
        row.liveTimeRange && row.liveTimeRange !== NO_LIVE_SESSION_TEXT
          ? row.liveTimeRange
          : (lb?.liveTimeRange as string | undefined),
      livePeriodText: row.livePeriodText ?? lb?.livePeriodText,
      actualStartAt: row.liveStartTime ?? lb?.actualStartAt,
      actualEndAt: row.liveEndTime ?? lb?.actualEndAt,
      scheduledStartAt: lb?.scheduledStartAt,
      scheduledEndAt: lb?.scheduledEndAt,
    }

    if (trendMode === 'intraday') {
      const anchorViews = allPerformanceViews.filter(
        (view) => String(view.anchorName ?? '').trim() === row.anchorName,
      )
      row.trend = buildLeaderboardRowIntradayTrend(
        anchorViews,
        params.startDate,
        mergedTrendRow,
      )
    } else {
      row.trend = (lb?.trend as AnchorTrend | undefined) ?? row.trend
    }
  }

  if (showOfflineOnReport) {
    const yifan = findYifanManualSystemAnchor(config)
    if (yifan) {
      const offlineViews = allPerformanceViewsWithOffline.filter(
        (v) => isOfflineDealView(v) && v.includedInGmv,
      )
      const offlineAmountYuan = roundMoneyYuan(gmvSplit.offlineGmv)
      const offlineDealCount = gmvSplit.offlineDealCount
      if (offlineAmountYuan > 0 || offlineDealCount > 0) {
        const already = anchorRows.some(
          (row) =>
            row.anchorId === yifan.id || isOfflineOnlyAnchor({ systemKey: row.systemKey }),
        )
        if (!already) {
          const totalForRatio = storeWideShipped.shippedAmountYuan + offlineAmountYuan
          const row = buildAnchorRow({
            config,
            anchorId: yifan.id,
            anchorName: yifan.name,
            shopName: '线下成交',
            reportDate: params.startDate,
            sessionLabel: '线下',
            shippedAmountYuan: 0,
            soldOrderCount: offlineDealCount,
            invalidOrderCount: 0,
            shippedOrders: listOfflineDealOrderLines(offlineViews, yifan.name),
            sessions: [],
            totalShippedAmountYuan: totalForRatio,
            scheduleAttendance: {
              ...EMPTY_SCHEDULE_ATTENDANCE,
              sessionLabel: '线下',
              shopName: '线下成交',
              displaySessionLabel: '线下',
            },
            liveTimeRange: '线下成交（无直播场次）',
            liveStartTime: null,
            liveEndTime: null,
            scheduleTimeRange: null,
            scheduleMatched: false,
            scheduleMatchReason: null,
          })
          row.gmvYuan = offlineAmountYuan
          row.amountRatio = safeRatioPercent(offlineAmountYuan, totalForRatio)
          row.avgOrderAmountYuan = roundMoneyYuan(
            safeDivide(offlineAmountYuan, offlineDealCount) ?? 0,
          )
          anchorRows.push(row)
        }
      }
    }
  }

  anchorRows.sort((a, b) => {
    const gmvDiff = Number(b.gmvYuan ?? 0) - Number(a.gmvYuan ?? 0)
    if (gmvDiff !== 0) return gmvDiff
    const shippedDiff = Number(b.shippedAmountYuan ?? 0) - Number(a.shippedAmountYuan ?? 0)
    if (shippedDiff !== 0) return shippedDiff
    const nameCmp = a.anchorName.localeCompare(b.anchorName, 'zh-CN')
    if (nameCmp !== 0) return nameCmp
    return (a.sessionLabel ?? '').localeCompare(b.sessionLabel ?? '', 'zh-CN')
  })

  const totalLiveDurationMinutes = sumUniqueDailyReportLiveDurationMinutes(
    liveAssignment.allSessions,
  )
  const liveSessionAttributionNote =
    liveAssignment.unassignedLiveSessionCount > 0
      ? `有 ${liveAssignment.unassignedLiveSessionCount} 场真实直播未匹配到排班，已计入总时长但不计入主播个人时长。`
      : null
  const liveRoomNewFollowers = enrichLiveRoomNewFollowersWithAnchorNames(
    await sumNewFollowersByLiveAccountForRange({
      preset: 'custom',
      startDate: params.startDate,
      endDate: params.endDate,
    }),
    anchorRows,
    liveAssignment,
  )
  const totalNewFollowerCount = liveRoomNewFollowers.reduce(
    (sum, row) => sum + row.newFollowerCount,
    0,
  )
  const totalLiveHours = safeDivide(totalLiveDurationMinutes, 60)
  const dedupedSummaryShippedOrders = listDailyReportShippedOrders(allPerformanceViews)
  const unassignedShippedOrderCount = unassignedShipped.soldOrderCount
  const unassignedShippedNote =
    unassignedShippedOrderCount > 0
      ? `有 ${unassignedShippedOrderCount} 笔订单暂未归到主播，已计入全店合计，请在主播归属里检查。`
      : null

  const dateLabel = formatDailyReportDateLabel(params.startDate)

  const imageSessions: DailyReportImageSession[] = []
  for (const row of anchorRows) {
    const sessions = sessionsByAnchorName.get(row.anchorName) ?? []
    if (sessions.length === 0) continue
    imageSessions.push(
      ...buildDailyReportImageSessionsForAnchor({
        anchorName: row.anchorName,
        shopName: row.shopName,
        color: row.color,
        sessions,
        shippedAmountYuan: row.shippedAmountYuan,
        soldOrderCount: row.soldOrderCount,
        gmvYuan: Number(row.gmvYuan ?? 0),
        refundAmountYuan: null,
      }),
    )
  }

  // 请假排班：在日报图片补/标记主播卡片（无直播场次也展示休假水印）
  const leaveRows = scheduleTable.rows.filter((r) => r.enabled && r.isOnLeave)
  for (const leave of leaveRows) {
    const anchorName = leave.anchorName.trim()
    const shopName = leave.shopName.trim() || leave.liveRoomName.trim()
    if (!anchorName || !shopName) continue
    const startTime = leave.startTime
    const endTime = leave.endTime
    const existing = imageSessions.find(
      (s) =>
        s.anchorName === anchorName &&
        s.shopName === shopName &&
        (s.liveTimeRange.includes(startTime) || s.startTime.includes(startTime)),
    )
    if (existing) {
      existing.isOnLeave = true
      continue
    }
    const color =
      leave.anchorColorSnapshot ||
      anchorRows.find((a) => a.anchorName === anchorName)?.color ||
      null
    imageSessions.push({
      id: `leave::${anchorName}::${shopName}::${startTime}::${endTime}`,
      shopName,
      anchorName,
      startTime,
      endTime,
      liveTimeRange: `${startTime}-${endTime}`,
      liveDurationText: '—',
      liveDurationMinutes: 0,
      shipmentAmountYuan: 0,
      gmvYuan: 0,
      orderCount: 0,
      refundAmountYuan: null,
      coverClickRate: null,
      stay60sUserCount: null,
      avgStayDurationSeconds: null,
      status: 'missing',
      color,
      isOnLeave: true,
    })
  }

  imageSessions.sort((a, b) => {
    const shopCmp = a.shopName.localeCompare(b.shopName, 'zh-CN')
    if (shopCmp !== 0) return shopCmp
    return a.startTime.localeCompare(b.startTime)
  })

  return {
    dateLabel,
    title: `${dateLabel} 主播日报`,
    startDate: params.startDate,
    endDate: params.endDate,
    summary: {
      totalShippedAmountYuan,
      totalSoldOrderCount,
      totalInvalidOrderCount,
      shippedOrders: dedupedSummaryShippedOrders,
      totalLiveDurationMinutes,
      assignedLiveDurationMinutes: liveAssignment.assignedLiveDurationMinutes,
      unassignedLiveDurationMinutes: liveAssignment.unassignedLiveDurationMinutes,
      unassignedLiveSessionCount: liveAssignment.unassignedLiveSessionCount,
      liveSessionAttributionNote,
      unassignedShippedOrderCount,
      unassignedShippedNote,
      overallHourlyAmountYuan: roundYuan(
        totalLiveHours != null ? safeDivide(totalShippedAmountYuan, totalLiveHours) : null,
      ),
      liveRoomNewFollowers,
      totalNewFollowerCount,
      onlineGmvYuan: roundMoneyYuan(gmvSplit.onlineGmv),
      offlineGmvYuan: roundMoneyYuan(gmvSplit.offlineGmv),
      offlineDealCount: gmvSplit.offlineDealCount,
      totalGmvYuan: roundMoneyYuan(gmvSplit.onlineGmv + gmvSplit.offlineGmv),
    },
    anchors: anchorRows,
    imageSessions,
  }
}
