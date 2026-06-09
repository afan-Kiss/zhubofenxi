import type { LiveSession } from '../types/anchor'

export function isOrderInLiveSession(orderTime: Date, session: LiveSession): boolean {
  const t = orderTime.getTime()
  return t >= session.startTime.getTime() && t <= session.endTime.getTime()
}

/** 匹配所有包含该下单时间的场次，返回时长最短的一场（最精确） */
export function findBestLiveSession(
  orderTime: Date | null,
  sessions: LiveSession[],
): LiveSession | null {
  if (!orderTime || !sessions.length) return null

  const matched = sessions.filter((s) => isOrderInLiveSession(orderTime, s))
  if (!matched.length) return null

  matched.sort((a, b) => a.durationMinutes - b.durationMinutes)
  return matched[0]
}
