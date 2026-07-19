/**
 * 日报图片：卡片时段/时长取小红书原始开播，金额分摊仍用裁剪时长
 * npx tsx apps/server/scripts/verify-daily-report-image-original-live-times.ts
 */
import assert from 'node:assert/strict'
import {
  buildDailyReportImageSessionsForAnchor,
  resolveImageSessionDisplayBounds,
} from '../src/services/daily-report-image-session'
import { collapseDailyReportDisplaySessions } from '../src/services/daily-report-session-display.util'
import type { AnchorLiveSessionBrief } from '../src/services/anchor-live-sessions.service'

function brief(partial: Partial<AnchorLiveSessionBrief> & Pick<AnchorLiveSessionBrief, 'liveId'>): AnchorLiveSessionBrief {
  return {
    liveId: partial.liveId,
    liveName: partial.liveName ?? '拾玉居和田玉',
    startTime: partial.startTime ?? '2026-07-18 09:00:00',
    endTime: partial.endTime ?? '2026-07-18 14:00:00',
    durationMinutes: partial.durationMinutes ?? 300,
    durationText: partial.durationText ?? '5小时',
    coverClickRate: partial.coverClickRate ?? 0.12,
    stay60sUserCount: partial.stay60sUserCount ?? 10,
    avgViewDurationSeconds: partial.avgViewDurationSeconds ?? 40,
    ...(partial as object),
  } as AnchorLiveSessionBrief
}

async function main() {
  const original = brief({
    liveId: 'live-abc',
    startTime: '2026-07-18 08:52:00',
    endTime: '2026-07-18 14:08:00',
    durationMinutes: 316,
  })
  const clipped = brief({
    liveId: 'live-abc::seg::row1::1000',
    startTime: '2026-07-18 09:00:00',
    endTime: '2026-07-18 14:00:00',
    durationMinutes: 300,
    sourceShopName: '拾玉居和田玉',
  } as AnchorLiveSessionBrief & { sourceShopName: string })

  const groups = collapseDailyReportDisplaySessions([clipped])
  assert.equal(groups.length, 1)
  const display = resolveImageSessionDisplayBounds(
    groups[0]!,
    new Map([['live-abc', original]]),
  )
  assert.equal(display.startTime, '2026-07-18 08:52:00')
  assert.equal(display.endTime, '2026-07-18 14:08:00')
  assert.equal(display.durationMinutes, 316)
  console.log('  ✓ 展示边界取平台原始开播/下播')

  const cards = buildDailyReportImageSessionsForAnchor({
    anchorName: '小白',
    shopName: '拾玉居和田玉',
    sessions: [clipped],
    originalSessions: [original],
    shippedAmountYuan: 1000,
    soldOrderCount: 10,
    gmvYuan: 1200,
  })
  assert.equal(cards.length, 1)
  assert.equal(cards[0]!.liveTimeRange, '08:52-14:08')
  assert.equal(cards[0]!.liveDurationMinutes, 316)
  assert.ok(cards[0]!.liveDurationText.includes('小时'))
  assert.equal(cards[0]!.shipmentAmountYuan, 1000)
  console.log('  ✓ 图片卡片时段/时长为真实开播，金额仍完整')

  const withoutOriginal = buildDailyReportImageSessionsForAnchor({
    anchorName: '小白',
    shopName: '拾玉居和田玉',
    sessions: [clipped],
    shippedAmountYuan: 1000,
    soldOrderCount: 10,
    gmvYuan: 1200,
  })
  assert.equal(withoutOriginal[0]!.liveTimeRange, '09:00-14:00')
  assert.equal(withoutOriginal[0]!.liveDurationMinutes, 300)
  console.log('  ✓ 无原始场次时回退裁剪时段')

  console.log('\nALL PASS')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
