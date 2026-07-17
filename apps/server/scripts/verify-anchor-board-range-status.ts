/**
 * 主播业绩 / 经营总览：日期范围覆盖状态与 0 单 empty 判定
 * npx tsx apps/server/scripts/verify-anchor-board-range-status.ts
 */
import assert from 'node:assert/strict'
import { resolveBoardDataDisplayStatus } from '../src/services/board-data-display-status.service'
import { jobCoversBusinessRange } from '../src/services/board-range-coverage.service'

function main() {
  console.log('verify-anchor-board-range-status\n')

  // 1-2: 已覆盖 + 0 单 => empty（今日/昨日同规则）
  for (const label of ['today', 'yesterday']) {
    const status = resolveBoardDataDisplayStatus({
      orderCountInRange: 0,
      totalOrderCount: 999,
      lastSuccessAt: '2026-07-17T01:00:00.000Z',
      syncStatus: 'success',
      coverageStatus: 'covered',
    })
    assert.equal(status, 'empty', label)
    console.log(`  ✓ ${label} 已同步覆盖但 0 单 => empty`)
  }

  // 3: 库内其他日期有单不影响
  const withOtherDates = resolveBoardDataDisplayStatus({
    orderCountInRange: 0,
    totalOrderCount: 5000,
    lastSuccessAt: '2026-07-17T01:00:00.000Z',
    syncStatus: 'success',
    coverageStatus: 'covered',
  })
  assert.equal(withOtherDates, 'empty')
  assert.notEqual(withOtherDates, 'coverage_missing')
  console.log('  ✓ 其他日期有订单不会误判 coverage_missing')

  // 4: 明确未覆盖
  assert.equal(
    resolveBoardDataDisplayStatus({
      orderCountInRange: 0,
      lastSuccessAt: '2026-07-01T01:00:00.000Z',
      syncStatus: 'success',
      coverageStatus: 'not_covered',
    }),
    'coverage_missing',
  )
  console.log('  ✓ 明确未覆盖 => coverage_missing')

  // 5-6: syncing
  assert.equal(
    resolveBoardDataDisplayStatus({
      orderCountInRange: 0,
      lastSuccessAt: null,
      syncStatus: 'running',
      coverageStatus: 'syncing',
    }),
    'syncing_no_cache',
  )
  assert.equal(
    resolveBoardDataDisplayStatus({
      orderCountInRange: 3,
      lastSuccessAt: '2026-07-17T01:00:00.000Z',
      syncStatus: 'running',
      coverageStatus: 'syncing',
    }),
    'syncing_with_cache',
  )
  console.log('  ✓ syncing_no_cache / syncing_with_cache')

  // unknown 不得冒充 coverage_missing
  assert.equal(
    resolveBoardDataDisplayStatus({
      orderCountInRange: 0,
      lastSuccessAt: null,
      syncStatus: 'idle',
      coverageStatus: 'unknown',
    }),
    'empty',
  )
  console.log('  ✓ unknown => empty（非 coverage_missing）')

  assert.equal(
    jobCoversBusinessRange({ startDate: '2026-07-01', endDate: '2026-07-17' }, '2026-07-17', '2026-07-17'),
    true,
  )
  assert.equal(
    jobCoversBusinessRange({ startDate: '2026-07-01', endDate: '2026-07-16' }, '2026-07-17', '2026-07-17'),
    false,
  )
  console.log('  ✓ jobCoversBusinessRange 边界')

  console.log('\nPASS')
}

main()
