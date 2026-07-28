/**
 * 未匹配场次提示大白话验收
 * 用法: npx tsx apps/server/scripts/verify-live-session-attribution-note.ts
 */
import assert from 'node:assert/strict'
import type { DailyReportLiveSession } from '../src/services/daily-report-live-sessions.service'
import { buildLiveSessionAttributionNote } from '../src/services/daily-report-live-sessions.service'

function session(partial: Partial<DailyReportLiveSession> & Pick<DailyReportLiveSession, 'liveId' | 'sourceShopCode' | 'sourceShopName' | 'startTime' | 'endTime'>): DailyReportLiveSession {
  const startMs = Date.parse(partial.startTime.replace(' ', 'T') + '+08:00')
  const endMs = Date.parse(partial.endTime.replace(' ', 'T') + '+08:00')
  const durationMinutes = Math.round(Math.max(0, endMs - startMs) / 60_000)
  return {
    liveName: partial.sourceShopName,
    liveAccountName: partial.sourceShopName,
    durationMinutes,
    durationText: `${durationMinutes}分`,
    sellerRealIncomeAmtYuan: 0,
    dealOrderCnt: 0,
    refundAmtYuan: 0,
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
    ...partial,
  }
}

const shortOpen = session({
  liveId: 'short',
  sourceShopCode: 'xyxiangyu',
  sourceShopName: 'XY祥钰珠宝',
  startTime: '2026-07-28 09:03:28',
  endTime: '2026-07-28 09:03:31',
})
const realOpen = session({
  liveId: 'real',
  sourceShopCode: 'xyxiangyu',
  sourceShopName: 'XY祥钰珠宝',
  startTime: '2026-07-28 09:21:07',
  endTime: '2026-07-28 13:52:43',
})

const withReopen = buildLiveSessionAttributionNote({
  unassignedSessions: [shortOpen],
  assignedSessions: [realOpen],
})
assert.equal(
  withReopen,
  '09:03-09:03 XY祥钰珠宝开播仅3秒，又重新开播',
  withReopen ?? '(null)',
)

const alone = buildLiveSessionAttributionNote({
  unassignedSessions: [shortOpen],
  assignedSessions: [],
})
assert.equal(
  alone,
  '09:03-09:03 XY祥钰珠宝开播仅3秒，未对上排班',
  alone ?? '(null)',
)

const longer = session({
  liveId: 'mid',
  sourceShopCode: 'hetianyayu',
  sourceShopName: '和田雅玉',
  startTime: '2026-07-28 08:00:00',
  endTime: '2026-07-28 08:12:00',
})
const longerNote = buildLiveSessionAttributionNote({
  unassignedSessions: [longer],
  assignedSessions: [],
})
assert.equal(
  longerNote,
  '08:00-08:12 和田雅玉开播仅12分，未对上排班',
  longerNote ?? '(null)',
)

assert.equal(
  buildLiveSessionAttributionNote({ unassignedSessions: [], assignedSessions: [] }),
  null,
)

console.log('PASS live-session-attribution-note')
