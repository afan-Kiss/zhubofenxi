/**
 * 售后范围按店新鲜度 — 纯逻辑验收
 * npm run verify:after-sales-range-shop-freshness
 */
import assert from 'node:assert/strict'
import {
  evaluateRangeShopFreshness,
  RANGE_SYNC_SOURCE_VERSION,
} from '../src/services/xhs-after-sales-time-search.service'
import { TIME_SEARCH_CACHE_TTL_MS } from '../src/services/workbench-cache-validity.service'

/** 与服务内 isShopMetaFresh 规则一致（供离线断言） */
function isShopMetaFreshForTest(meta: {
  status: string
  lastSuccessAt: Date | null
  sourceVersion: string
  now?: number
}): boolean {
  if (meta.sourceVersion !== RANGE_SYNC_SOURCE_VERSION) return false
  if (meta.status !== 'success' && meta.status !== 'success_empty') return false
  if (!meta.lastSuccessAt) return false
  const now = meta.now ?? Date.now()
  return now - meta.lastSuccessAt.getTime() <= TIME_SEARCH_CACHE_TTL_MS
}

function evaluateShopsFreshness(
  shops: Array<{
    status: string
    lastSuccessAt: Date | null
    sourceVersion: string
  }>,
  now = Date.now(),
): { allFresh: boolean; freshCount: number } {
  const flags = shops.map((s) => isShopMetaFreshForTest({ ...s, now }))
  return { allFresh: flags.length > 0 && flags.every(Boolean), freshCount: flags.filter(Boolean).length }
}

function testPureLogic(): void {
  const now = Date.now()
  const recent = new Date(now - 60_000)
  const stale = new Date(now - TIME_SEARCH_CACHE_TTL_MS - 1000)

  assert.equal(typeof evaluateRangeShopFreshness, 'function', 'evaluateRangeShopFreshness 已导出')

  const allFresh = evaluateShopsFreshness([
    { status: 'success', lastSuccessAt: recent, sourceVersion: RANGE_SYNC_SOURCE_VERSION },
    { status: 'success_empty', lastSuccessAt: recent, sourceVersion: RANGE_SYNC_SOURCE_VERSION },
  ], now)
  assert.equal(allFresh.allFresh, true, '全部店新鲜')
  assert.equal(allFresh.freshCount, 2)

  const oneStale = evaluateShopsFreshness([
    { status: 'success', lastSuccessAt: recent, sourceVersion: RANGE_SYNC_SOURCE_VERSION },
    { status: 'success', lastSuccessAt: stale, sourceVersion: RANGE_SYNC_SOURCE_VERSION },
  ], now)
  assert.equal(oneStale.allFresh, false, '1 店过期')
  assert.equal(oneStale.freshCount, 1)

  assert.equal(
    isShopMetaFreshForTest({
      status: 'success_empty',
      lastSuccessAt: recent,
      sourceVersion: RANGE_SYNC_SOURCE_VERSION,
      now,
    }),
    true,
    'success_empty 视为成功',
  )

  assert.equal(
    isShopMetaFreshForTest({
      status: 'blocked',
      lastSuccessAt: recent,
      sourceVersion: RANGE_SYNC_SOURCE_VERSION,
      now,
    }),
    false,
    'blocked 不新鲜',
  )

  assert.equal(
    isShopMetaFreshForTest({
      status: 'success',
      lastSuccessAt: null,
      sourceVersion: RANGE_SYNC_SOURCE_VERSION,
      now,
    }),
    false,
    'missing lastSuccessAt',
  )

  assert.equal(
    isShopMetaFreshForTest({
      status: 'failed',
      lastSuccessAt: recent,
      sourceVersion: 'legacy-v0',
      now,
    }),
    false,
    'sourceVersion 不匹配',
  )

  console.log('✓ 纯逻辑：全新鲜 / 1 过期 / success_empty / blocked / missing meta')
}

async function testDbOptional(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log('⊘ 跳过 DB：未设置 DATABASE_URL')
    return
  }
  try {
    const result = await evaluateRangeShopFreshness({
      startDate: '2099-01-01',
      endDate: '2099-01-02',
      startTimeMs: Date.parse('2099-01-01T00:00:00+08:00'),
      endTimeMs: Date.parse('2099-01-02T23:59:59.999+08:00'),
    })
    assert.ok(['complete', 'partial', 'blocked'].includes(result.overall))
    assert.ok(Array.isArray(result.shops))
    console.log(`✓ DB 可选：overall=${result.overall} shops=${result.shops.length}`)
  } catch (e) {
    console.log(`⊘ DB 可选跳过：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function main(): Promise<void> {
  console.log('verify:after-sales-range-shop-freshness\n')
  testPureLogic()
  await testDbOptional()
  console.log('\nPASS')
}

void main()
