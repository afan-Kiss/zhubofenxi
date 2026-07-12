/**
 * 主播归属健康检查（只读）：排班冲突 / 模板偏离 / 未归属 / 品退数量一致性等
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

export interface AnchorAttributionHealthIssue {
  date?: string
  orderNo?: string
  reason: string
}

export interface AnchorAttributionHealthReport {
  generatedAt: string
  startDate: string
  endDate: string
  scheduleConflictCount: number
  templateDeviationCount: number
  unassignedOrderCount: number
  crossShopAbnormalAttributionCount: number
  leaderboardCardDetailMismatchCount: number
  qualityCardDetailMismatchCount: number
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

export async function buildAnchorAttributionHealthReport(input?: {
  startDate?: string
  endDate?: string
}): Promise<AnchorAttributionHealthReport> {
  const startDate = input?.startDate ?? ANCHOR_NEW_SCHEDULE_START_DATE
  const endDate = input?.endDate ?? formatDateKeyShanghai(new Date())
  const issues: AnchorAttributionHealthIssue[] = []

  let scheduleConflictCount = 0
  let templateDeviationCount = 0
  let crossShopAbnormalAttributionCount = 0

  const dates = listDates(startDate, endDate)
  for (const dateKey of dates) {
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
    if (swap) {
      scheduleConflictCount += 1
      issues.push({ date: dateKey, reason: swap.message })
    }

    for (const r of draft) {
      const tpl = NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.find(
        (t) =>
          t.shopName === r.shopName &&
          (t.startTime === r.startTime ||
            (dateKey >= (t.effectiveFrom ?? '') && t.shopName === r.shopName && t.startTime === r.startTime)),
      )
      const tpl2 =
        tpl ??
        NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.find(
          (t) => t.shopName === r.shopName && t.startTime === r.startTime,
        )
      if (tpl2 && tpl2.anchorName !== r.anchorName) {
        templateDeviationCount += 1
        issues.push({
          date: dateKey,
          reason: `${r.shopName} ${r.startTime}–${r.endTime} 当前「${r.anchorName}」偏离模板「${tpl2.anchorName}」`,
        })
      }
    }
  }

  // 未归属 + 卡片/明细一致性（当月至今）
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
  let leaderboardCardDetailMismatchCount = 0
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
      pageSize: 20,
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
  }

  const passed =
    scheduleConflictCount === 0 &&
    templateDeviationCount === 0 &&
    unassignedOrderCount === 0 &&
    crossShopAbnormalAttributionCount === 0 &&
    leaderboardCardDetailMismatchCount === 0 &&
    qualityCardDetailMismatchCount === 0

  return {
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    scheduleConflictCount,
    templateDeviationCount,
    unassignedOrderCount,
    crossShopAbnormalAttributionCount,
    leaderboardCardDetailMismatchCount,
    qualityCardDetailMismatchCount,
    issues: issues.slice(0, 100),
    passed,
    message: passed ? '主播业绩归属检查通过' : '主播业绩暂不建议用于结算',
  }
}
