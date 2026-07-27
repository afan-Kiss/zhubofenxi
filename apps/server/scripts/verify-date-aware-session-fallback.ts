/**
 * 日期感知固定场次回退边界
 * npx tsx apps/server/scripts/verify-date-aware-session-fallback.ts
 */
import assert from 'node:assert/strict'
import {
  normalizeShopSessionKey,
  resolveNewLiveSessionPeriod,
  resolveShopSessionFallbackForDate,
} from '../src/services/shop-session-fallback.service'

function ms(s: string) {
  return Date.parse(`${s}+08:00`)
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`)
}

function main() {
  console.log('verify-date-aware-session-fallback')

  // 7 月时段边界
  assert.equal(resolveNewLiveSessionPeriod(new Date(ms('2026-07-02T09:29:59'))), null)
  assert.equal(resolveNewLiveSessionPeriod(new Date(ms('2026-07-02T09:30:00'))), 'morning')
  assert.equal(resolveNewLiveSessionPeriod(new Date(ms('2026-07-02T13:59:59'))), 'morning')
  assert.equal(resolveNewLiveSessionPeriod(new Date(ms('2026-07-02T14:00:00'))), 'noon')
  assert.equal(resolveNewLiveSessionPeriod(new Date(ms('2026-07-02T18:29:59'))), 'noon')
  assert.equal(resolveNewLiveSessionPeriod(new Date(ms('2026-07-02T18:30:00'))), 'evening')
  assert.equal(resolveNewLiveSessionPeriod(new Date(ms('2026-07-02T22:59:59'))), 'evening')
  assert.equal(resolveNewLiveSessionPeriod(new Date(ms('2026-07-02T23:00:00'))), null)
  ok('7 月三班制边界')

  const shiyu = normalizeShopSessionKey('拾玉居和田玉')
  assert.equal(resolveShopSessionFallbackForDate(shiyu, ms('2026-07-02T09:29:59')), null)
  assert.equal(
    resolveShopSessionFallbackForDate(shiyu, ms('2026-07-02T09:30:00'))?.anchorName,
    '子杰',
  )
  assert.equal(
    resolveShopSessionFallbackForDate(shiyu, ms('2026-07-02T13:59:59'))?.anchorName,
    '子杰',
  )
  assert.equal(resolveShopSessionFallbackForDate(shiyu, ms('2026-07-02T14:00:00')), null)
  assert.equal(resolveShopSessionFallbackForDate(shiyu, ms('2026-07-02T18:29:59')), null)
  assert.equal(
    resolveShopSessionFallbackForDate(shiyu, ms('2026-07-02T18:30:00'))?.anchorName,
    '飞云',
  )
  assert.equal(resolveShopSessionFallbackForDate(shiyu, ms('2026-07-02T23:00:00')), null)
  ok('7 月拾玉居早/晚场')

  const xy = normalizeShopSessionKey('XY祥钰珠宝')
  // 7/2 小小尚未生效 → 早场不得归子杰，应为 null
  assert.equal(resolveShopSessionFallbackForDate(xy, ms('2026-07-02T10:00:00')), null)
  assert.equal(
    resolveShopSessionFallbackForDate(xy, ms('2026-07-16T10:00:00'))?.anchorName,
    '小小',
  )
  assert.equal(resolveShopSessionFallbackForDate(xy, ms('2026-07-02T15:00:00')), null) // 小白专用
  ok('7 月 XY 不得归子杰；小小生效后早场归小小')

  // 6 月兼容
  assert.equal(
    resolveShopSessionFallbackForDate(xy, ms('2026-06-20T10:00:00'))?.anchorName,
    '子杰',
  )
  assert.equal(resolveShopSessionFallbackForDate(xy, ms('2026-06-20T15:00:00')), null) // 小白午场
  assert.equal(
    resolveShopSessionFallbackForDate(shiyu, ms('2026-06-20T20:00:00'))?.anchorName,
    '飞云',
  )
  ok('6 月历史宽时段兼容')

  console.log('ALL PASS')
}

main()
