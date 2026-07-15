/**
 * 经营缓存按支付日合并失效 — 验收
 * npm run verify:business-cache-range-invalidation
 */
import assert from 'node:assert/strict'
import {
  flushBusinessBoardCacheRangeInvalidations,
  getPendingBusinessBoardCacheInvalidationCount,
  resetBusinessBoardCacheInvalidationQueueForTests,
  scheduleBusinessBoardCacheInvalidationForPayTime,
} from '../src/services/business-cache-range-invalidation.service'

async function main(): Promise<void> {
  console.log('verify:business-cache-range-invalidation\n')

  resetBusinessBoardCacheInvalidationQueueForTests()

  const payDate = '2026-07-10T14:30:00+08:00'
  for (let i = 0; i < 100; i++) {
    scheduleBusinessBoardCacheInvalidationForPayTime(payDate)
  }

  const pending = getPendingBusinessBoardCacheInvalidationCount()
  assert.equal(pending, 1, '同支付日 100 次调度应合并为 1 条待处理')

  const flushed = await flushBusinessBoardCacheRangeInvalidations()
  assert.equal(flushed.changeCount, 1, 'flush changeCount 应为 1 而非 100')
  assert.ok(flushed.dates.length >= 1, 'dates 非空')
  assert.ok(Array.isArray(flushed.presets), 'presets 为数组')
  assert.equal(getPendingBusinessBoardCacheInvalidationCount(), 0, 'flush 后队列清空')

  const emptyFlush = await flushBusinessBoardCacheRangeInvalidations()
  assert.equal(emptyFlush.changeCount, 0)

  console.log(
    `✓ 合并失效：pending→1 flush changeCount=${flushed.changeCount} dates=${flushed.dates.join(',')} presets=${flushed.presets.length}`,
  )
  console.log('\nPASS')
}

void main()
