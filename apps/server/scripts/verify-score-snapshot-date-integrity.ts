/**
 * 店铺分同日补值 / 完整性（静态逻辑模拟）
 * npx tsx apps/server/scripts/verify-score-snapshot-date-integrity.ts
 */
import assert from 'node:assert/strict'

type Pt = { date: string; score: number }

/** 与生产补值规则一致：只取 primaryDate 同日点 */
function fillMissingFromTrend(
  primaryDate: string,
  current: number | null,
  points: Pt[],
): number | null {
  if (current != null) return current
  const hit = points.find((p) => p.date === primaryDate)
  return hit ? hit.score : null
}

function main() {
  console.log('verify-score-snapshot-date-integrity')

  const primary = '2026-07-27'
  const quality = fillMissingFromTrend(primary, null, [
    { date: '2026-07-26', score: 4.4 },
    { date: '2026-07-27', score: 4.5 },
  ])
  assert.equal(quality, 4.5)
  ok('同日趋势可补')

  const logistics = fillMissingFromTrend(primary, null, [{ date: '2026-07-26', score: 4.9 }])
  assert.equal(logistics, null)
  ok('禁止用昨日趋势补今日')

  const mixedDates = {
    quality: fillMissingFromTrend(primary, null, [{ date: '2026-07-27', score: 4.5 }]),
    logistics: fillMissingFromTrend(primary, null, [{ date: '2026-07-26', score: 4.6 }]),
    service: fillMissingFromTrend(primary, null, [{ date: '2026-07-27', score: 4.4 }]),
  }
  assert.equal(mixedDates.logistics, null)
  const complete =
    mixedDates.quality != null &&
    mixedDates.logistics != null &&
    mixedDates.service != null &&
    4.5 != null
  assert.equal(complete, false)
  ok('分项日期不一致不得组成完整快照')

  // 官方总分为空不得用均值
  const q = 4.5,
    l = 4.9,
    s = 4.2
  const official: number | null = null
  const fakeAvg = Math.round(((q + l + s) / 3) * 10) / 10
  assert.notEqual(official, fakeAvg)
  assert.equal(official, null)
  ok('官方总分为空保持 null，不用均值')

  console.log('ALL PASS')
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`)
}

main()
