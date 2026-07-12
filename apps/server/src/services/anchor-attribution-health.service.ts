/**
 * 主播归属健康检查（canonical 唯一归属口径）
 */
import { prisma } from '../lib/prisma'
import { NEW_SCHEDULE_TEMPLATE_SEEDS_20260701 } from './anchor-schedule-template.service'
import { detectScheduleConflicts } from '../utils/anchor-schedule-time.util'
import { detectTemplateAnchorSwap } from '../utils/schedule-hard-validation.util'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { ANCHOR_NEW_SCHEDULE_START_DATE } from '../config/anchor-schedule.constants'
import { buildAndSetBusinessBoardCache } from './business-cache.service'
import { executeBoardLocalQuery } from './board-local-query.service'
import { buildAnchorQualityRefundDrill } from './board-drill.service'
import { CANONICAL_ATTRIBUTION_VERSION } from './canonical-order-attribution.service'

export interface AnchorAttributionHealthIssue {
  date?: string
  orderNo?: string
  reason: string
}

export interface AnchorAttributionHealthReport {
  generatedAt: string
  startDate: string
  endDate: string
  attributionAlgorithmVersion: string
  scheduleConflictCount: number
  templateDeviationWithoutConfirmCount: number
  unassignedOrderCount: number
  conflictOrderCount: number
  crossShopAbnormalAttributionCount: number
  unconfirmedScheduleUsedCount: number
  qualityUnmatchedCount: number
  qualityCrossAnchorDupCount: number
  qualityAnchorMismatchCount: number
  leaderboardCardDetailMismatchCount: number
  qualityCardDetailMismatchCount: number
  shopTotalMismatchCount: number
  issues: AnchorAttributionHealthIssue[]
  passed: boolean
  message: string
}

function listDates(start: string, end: string): string[] {
  const out: string[] = []
  let cursor = start
  while (cursor <= end) {
    out.push(cursor)
    const d = new Date(`${cursor}T12:00:00+08:00`)
    d.setDate(d.getDate() + 1)
    cursor = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  }
  return out
}

function hm(ms: number, dateKey: string, role: 'start' | 'end'): string {
  const d = new Date(ms)
  const text = d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  if (role === 'end' && text === '00:00' && day > dateKey) return '24:00'
  return text
}

function hasConfirmReason(note: string | null | undefined, confirmNote: string | null | undefined): boolean {
  const text = `${note ?? ''} ${confirmNote ?? ''}`.trim()
  if (!text) return false
  if (/临时调班|人工确认|修改原因|历史修改原因|调班/.test(text)) return true
  // 模板备注不算
  if (/^(早|午|晚)场/.test(text.trim())) return false
  return text.length >= 4
}

export async function buildAnchorAttributionHealthReport(input?: {
  startDate?: string
  endDate?: string
}): Promise<AnchorAttributionHealthReport> {
  const startDate = input?.startDate ?? ANCHOR_NEW_SCHEDULE_START_DATE
  const endDate = input?.endDate ?? formatDateKeyShanghai(new Date())
  const issues: AnchorAttributionHealthIssue[] = []

  let scheduleConflictCount = 0
  let templateDeviationWithoutConfirmCount = 0
  let crossShopAbnormalAttributionCount = 0

  for (const dateKey of listDates(startDate, endDate)) {
    const rows = await prisma.anchorDailySchedule.findMany({
      where: { scheduleDate: dateKey, enabled: true },
      orderBy: { startAt: 'asc' },
    })
    if (!rows.length) continue

    const draft = rows.map((r) => ({
      anchorName: r.anchorName,
      shopName: r.shopName,
      liveRoomName: r.liveRoomName,
      startTime: hm(r.startAt.getTime(), dateKey, 'start'),
      endTime: hm(r.endAt.getTime(), dateKey, 'end'),
      enabled: true,
      note: r.note,
    }))

    const conflicts = detectScheduleConflicts(
      rows.map((r) => ({
        anchorName: r.anchorName,
        shopName: r.shopName,
        liveRoomName: r.liveRoomName,
        startAt: r.startAt,
        endAt: r.endAt,
      })),
    )
    for (const c of conflicts) {
      scheduleConflictCount += 1
      if (c.type === 'anchor_overlap') crossShopAbnormalAttributionCount += 1
      issues.push({ date: dateKey, reason: c.message })
    }

    const swap = detectTemplateAnchorSwap(dateKey, draft)
    const allConfirmed = rows.every((r) => r.confirmed)
    const allHaveReason = rows.every((r) => hasConfirmReason(r.note, r.confirmNote))
    if (swap && !(allConfirmed && allHaveReason)) {
      scheduleConflictCount += 1
      issues.push({ date: dateKey, reason: swap.message })
    }

    for (const r of draft) {
      const tpl = NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.find(
        (t) => t.shopName === r.shopName && t.startTime === r.startTime,
      )
      if (!tpl || tpl.anchorName === r.anchorName) continue
      const dbRow = rows.find((x) => x.anchorName === r.anchorName && x.shopName === r.shopName)
      const okTemp =
        Boolean(dbRow?.confirmed) && hasConfirmReason(dbRow?.note, dbRow?.confirmNote)
      if (okTemp) continue
      templateDeviationWithoutConfirmCount += 1
      issues.push({
        date: dateKey,
        reason: `${r.shopName} ${r.startTime}–${r.endTime} 偏离模板「${tpl.anchorName}」且无确认/原因`,
      })
    }
  }

  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate,
    endDate,
  })
  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate,
    endDate,
    role: 'super_admin',
    username: 'anchor-attribution-health',
  })
  const leaderboard = (local.anchorLeaderboard ?? []) as Array<Record<string, unknown>>
  const unassigned = leaderboard.find((r) => String(r.anchorName) === '未归属')
  const unassignedOrderCount = Number(unassigned?.orderCount ?? 0)
  if (unassignedOrderCount > 0) {
    issues.push({ reason: `未归属订单 ${unassignedOrderCount} 笔` })
  }

  let qualityCardDetailMismatchCount = 0
  let qualityCrossAnchorDupCount = 0
  const packageOwners = new Map<string, string>()

  for (const row of leaderboard) {
    const anchorName = String(row.anchorName ?? '')
    if (!anchorName) continue
    const cardCount = Number(row.qualityReturnCount ?? 0)
    const drawer = await buildAnchorQualityRefundDrill({
      preset: 'custom',
      startDate,
      endDate,
      anchorName,
      page: 1,
      pageSize: 100,
      role: 'super_admin',
      username: 'anchor-attribution-health',
    })
    const total = drawer.pagination?.total ?? 0
    if (cardCount !== total) {
      qualityCardDetailMismatchCount += 1
      issues.push({
        reason: `${anchorName} 品退卡片 ${cardCount} 与明细 ${total} 不一致`,
      })
    }
    for (const r of drawer.rows ?? []) {
      const rec = r as Record<string, unknown>
      const orderNo = String(rec.orderNo ?? '')
      const payAnchor = String(rec.paymentAnchorName ?? rec.qualityAttributionAnchorName ?? '')
      const qualityAnchor = String(rec.qualityAttributionAnchorName ?? '')
      if (orderNo && payAnchor && qualityAnchor && payAnchor !== qualityAnchor) {
        issues.push({
          orderNo,
          reason: `品退主播「${qualityAnchor}」与订单主播「${payAnchor}」不一致`,
        })
      }
      const key = orderNo || String(rec.packageId ?? '')
      if (!key) continue
      const prev = packageOwners.get(key)
      if (prev && prev !== anchorName) {
        qualityCrossAnchorDupCount += 1
        issues.push({ orderNo: key, reason: `品退订单同时出现在「${prev}」与「${anchorName}」` })
      } else {
        packageOwners.set(key, anchorName)
      }
    }
  }

  const cardPaySum = leaderboard.reduce((s, r) => s + Number(r.orderCount ?? 0), 0)
  const summaryPay = Number((local.summary as Record<string, unknown> | undefined)?.orderCount ?? 0)
  const shopTotalMismatchCount =
    summaryPay > 0 && Math.abs(cardPaySum - summaryPay) > 0 ? 1 : 0
  if (shopTotalMismatchCount) {
    issues.push({
      reason: `主播合计支付单数 ${cardPaySum} 与全店 ${summaryPay} 不一致`,
    })
  }

  const qualityAnchorMismatchCount = issues.filter((i) =>
    i.reason.includes('品退主播') && i.reason.includes('不一致'),
  ).length

  const passed =
    scheduleConflictCount === 0 &&
    templateDeviationWithoutConfirmCount === 0 &&
    unassignedOrderCount === 0 &&
    crossShopAbnormalAttributionCount === 0 &&
    qualityCardDetailMismatchCount === 0 &&
    qualityCrossAnchorDupCount === 0 &&
    qualityAnchorMismatchCount === 0 &&
    shopTotalMismatchCount === 0

  return {
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    attributionAlgorithmVersion: CANONICAL_ATTRIBUTION_VERSION,
    scheduleConflictCount,
    templateDeviationWithoutConfirmCount,
    unassignedOrderCount,
    conflictOrderCount: 0,
    crossShopAbnormalAttributionCount,
    unconfirmedScheduleUsedCount: 0,
    qualityUnmatchedCount: 0,
    qualityCrossAnchorDupCount,
    qualityAnchorMismatchCount,
    leaderboardCardDetailMismatchCount: 0,
    qualityCardDetailMismatchCount,
    shopTotalMismatchCount,
    issues: issues.slice(0, 120),
    passed,
    message: passed
      ? '主播业绩归属检查通过，可以用于结算。'
      : '主播业绩暂不建议用于结算。',
  }
}
