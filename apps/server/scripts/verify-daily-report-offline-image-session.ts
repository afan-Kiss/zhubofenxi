/**
 * 日报图片：逸凡线下成交独立卡片
 * npx tsx apps/server/scripts/verify-daily-report-offline-image-session.ts
 */
import assert from 'node:assert/strict'
import { buildDailyReportOfflineImageSession } from '../src/services/daily-report-image-session'

async function main() {
  const empty = buildDailyReportOfflineImageSession({
    anchorName: '逸凡',
    gmvYuan: 0,
    dealCount: 0,
    reportDate: '2026-07-18',
  })
  assert.equal(empty, null)
  console.log('  ✓ 无业绩时不生成线下卡片')

  const card = buildDailyReportOfflineImageSession({
    anchorName: '逸凡',
    color: '#0ea5e9',
    gmvYuan: 12880.5,
    dealCount: 3,
    reportDate: '2026-07-18',
  })
  assert.ok(card)
  assert.equal(card!.isOfflineDeal, true)
  assert.equal(card!.shopName, '线下成交')
  assert.equal(card!.liveTimeRange, '线下成交')
  assert.equal(card!.gmvYuan, 12880.5)
  assert.equal(card!.orderCount, 3)
  assert.equal(card!.shipmentAmountYuan, 0)
  assert.equal(card!.liveDurationMinutes, 0)
  assert.equal(card!.coverClickRate, null)
  assert.equal(card!.id, 'offline::逸凡::2026-07-18')
  console.log('  ✓ 线下卡片含 GMV/成交单数，无发货与流量指标')

  console.log('verify-daily-report-offline-image-session: OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
