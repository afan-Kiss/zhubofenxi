import { prisma } from '../../lib/prisma'
import { findAnchorByName } from '../anchor-rules.service'
import { getAnchorConfigSync } from '../anchor.service'
import { getEffectiveSchedulesForDate } from '../anchor-daily-schedule.service'
import { orderLiveRoomMatchesSchedule } from '../../utils/shop-name-normalize.util'

export type LuckyGiftAnchorSource = 'room_exact' | 'session_time' | 'schedule' | 'unresolved'

export type LuckyGiftAnchorAttribution = {
  anchorName: string | null
  anchorId: string | null
  anchorAttributionSource: LuckyGiftAnchorSource
}

type WinnerRow = {
  id: string
  liveAccountId: string
  liveAccountName: string
  winTime: Date | null
  draw: { roomId: string } | null
}

function sessionKey(liveAccountId: string, liveId: string): string {
  return `${liveAccountId}::${liveId}`
}

function resolveAnchorId(anchorName: string): string {
  const config = getAnchorConfigSync()
  const found = findAnchorByName(config, anchorName)
  return found?.id ?? `extra-${anchorName}`
}

function shanghaiDateKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

async function loadScheduleByDate(dateKey: string) {
  return getEffectiveSchedulesForDate(dateKey)
}

export function matchScheduleAnchor(
  liveAccountName: string,
  winTime: Date,
  rows: Array<{
    anchorName: string
    shopName: string
    liveRoomName: string
    startAt: Date
    endAt: Date
  }>,
): string | null {
  const winMs = winTime.getTime()
  for (const row of rows) {
    if (!orderLiveRoomMatchesSchedule(liveAccountName, row.shopName, row.liveRoomName)) continue
    if (winMs >= row.startAt.getTime() && winMs <= row.endAt.getTime()) {
      return row.anchorName.trim() || null
    }
  }
  return null
}

export function matchSessionByTime(
  liveAccountId: string,
  winTime: Date,
  sessions: Array<{
    liveAccountId: string
    liveId: string
    anchorName: string | null
    startTime: Date | null
    endTime: Date | null
  }>,
): string | null {
  const winMs = winTime.getTime()
  for (const s of sessions) {
    if (s.liveAccountId !== liveAccountId) continue
    if (!s.startTime) continue
    const start = s.startTime.getTime()
    const end = s.endTime?.getTime() ?? start + 6 * 3_600_000
    if (winMs >= start && winMs <= end && s.anchorName?.trim()) {
      return s.anchorName.trim()
    }
  }
  return null
}

export async function resolveLuckyGiftAnchorsBatch(
  winners: WinnerRow[],
): Promise<Map<string, LuckyGiftAnchorAttribution>> {
  const out = new Map<string, LuckyGiftAnchorAttribution>()
  if (winners.length === 0) return out

  const roomPairs = new Map<string, { liveAccountId: string; roomId: string }>()
  for (const w of winners) {
    const roomId = w.draw?.roomId?.trim()
    if (roomId) roomPairs.set(sessionKey(w.liveAccountId, roomId), { liveAccountId: w.liveAccountId, roomId })
  }

  const exactSessions = roomPairs.size
    ? await prisma.xhsRawLiveSession.findMany({
        where: {
          OR: [...roomPairs.values()].map((p) => ({
            liveAccountId: p.liveAccountId,
            liveId: p.roomId,
          })),
        },
        select: {
          liveAccountId: true,
          liveId: true,
          anchorName: true,
          startTime: true,
          endTime: true,
        },
      })
    : []

  const exactMap = new Map<string, (typeof exactSessions)[number]>()
  for (const s of exactSessions) {
    if (!s.liveId) continue
    exactMap.set(sessionKey(s.liveAccountId, s.liveId), s)
  }

  const accountIds = [...new Set(winners.map((w) => w.liveAccountId))]
  const timeFallbackSessions = (
    await prisma.xhsRawLiveSession.findMany({
      where: { liveAccountId: { in: accountIds }, liveId: { not: null } },
      select: {
        liveAccountId: true,
        liveId: true,
        anchorName: true,
        startTime: true,
        endTime: true,
      },
    })
  ).filter((s): s is typeof s & { liveId: string } => Boolean(s.liveId))

  const scheduleCache = new Map<string, Awaited<ReturnType<typeof loadScheduleByDate>>>()

  async function resolveFromSchedule(w: WinnerRow): Promise<string | null> {
    if (!w.winTime) return null
    const dateKey = shanghaiDateKey(w.winTime)
    let sched = scheduleCache.get(dateKey)
    if (!sched) {
      sched = await loadScheduleByDate(dateKey)
      scheduleCache.set(dateKey, sched)
    }
    return matchScheduleAnchor(
      w.liveAccountName,
      w.winTime,
      [...sched.manual, ...sched.generated, ...sched.virtual].map((r) => ({
        anchorName: r.anchorName,
        shopName: r.shopName,
        liveRoomName: r.liveRoomName,
        startAt: r.startAt,
        endAt: r.endAt,
      })),
    )
  }

  for (const w of winners) {
    const roomId = w.draw?.roomId?.trim() ?? ''
    let anchorName: string | null = null
    let source: LuckyGiftAnchorSource = 'unresolved'

    const exact = roomId ? exactMap.get(sessionKey(w.liveAccountId, roomId)) : null
    if (exact?.anchorName?.trim()) {
      anchorName = exact.anchorName.trim()
      source = 'room_exact'
    } else if (exact) {
      const fromSchedule = await resolveFromSchedule(w)
      if (fromSchedule) {
        anchorName = fromSchedule
        source = 'schedule'
      }
    } else if (w.winTime) {
      const byTime = matchSessionByTime(w.liveAccountId, w.winTime, timeFallbackSessions)
      if (byTime) {
        anchorName = byTime
        source = 'session_time'
      } else {
        const fromSchedule = await resolveFromSchedule(w)
        if (fromSchedule) {
          anchorName = fromSchedule
          source = 'schedule'
        }
      }
    }

    out.set(w.id, {
      anchorName,
      anchorId: anchorName ? resolveAnchorId(anchorName) : null,
      anchorAttributionSource: source,
    })
  }

  return out
}
