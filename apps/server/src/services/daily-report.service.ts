import { getAnchorConfigSync } from './anchor.service'
import { buildAnchorDrill } from './board-drill.service'
import type { UserRole } from '../types/roles'

export interface DailyReportAnchorSection {
  anchorId: string
  anchorName: string
  stats: Record<string, unknown> | null
  liveSessions: Array<{
    liveId: string
    liveName: string
    startTime: string
    endTime: string
    durationMinutes: number
    durationText: string
  }>
  liveSummaryText: string
  blacklistedBuyerIds: string[]
  rows: Array<Record<string, unknown>>
  orderTotal: number
}

export interface DailyReportPayload {
  startDate: string
  endDate: string
  sections: DailyReportAnchorSection[]
}

export async function buildDailyReport(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<DailyReportPayload> {
  const config = getAnchorConfigSync()
  const anchors = config.anchors.filter((a) => a.enabled)
  const sections: DailyReportAnchorSection[] = []

  for (const anchor of anchors) {
    const drill = await buildAnchorDrill({
      preset: params.preset ?? 'custom',
      startDate: params.startDate,
      endDate: params.endDate,
      anchorId: anchor.id,
      anchorName: anchor.name,
      page: 1,
      pageSize: 200,
      sort: 'time_desc',
      role: params.role,
      username: params.username,
    })

    const orderTotal = drill.pagination.total
    const hasLive = (drill.liveSessions?.length ?? 0) > 0
    if (orderTotal === 0 && !hasLive) continue

    sections.push({
      anchorId: drill.anchorId,
      anchorName: drill.anchorName,
      stats: drill.stats as Record<string, unknown> | null,
      liveSessions: drill.liveSessions ?? [],
      liveSummaryText: drill.liveSummaryText ?? '',
      blacklistedBuyerIds: drill.blacklistedBuyerIds ?? [],
      rows: drill.rows as unknown as Array<Record<string, unknown>>,
      orderTotal,
    })
  }

  return {
    startDate: params.startDate,
    endDate: params.endDate,
    sections,
  }
}
