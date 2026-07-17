/**
 * 304 缓存恢复 / ETag 重试规则（纯逻辑）
 * npx tsx apps/server/scripts/verify-board-etag-304-rehydrate.ts
 */
import assert from 'node:assert/strict'

type Cached = {
  preset: string
  startDate: string
  endDate: string
  rangeKey?: string
  summary: Record<string, unknown>
}

function isCachedPayloadUsable(data: Cached | null | undefined): boolean {
  if (!data) return false
  if (!data.preset || !data.startDate || !data.endDate) return false
  if (!data.summary || typeof data.summary !== 'object') return false
  return true
}

function resolveCachedRangeKey(cached: Cached): string {
  return cached.rangeKey ?? `${cached.preset}|${cached.startDate}|${cached.endDate}`
}

function canRevalidateWithEtag(params: {
  etag?: string
  cached: Cached | null
  fetchRangeKey: string
  skipEtag?: boolean
}): boolean {
  if (params.skipEtag) return false
  if (!params.etag || !params.cached) return false
  if (!isCachedPayloadUsable(params.cached)) return false
  return resolveCachedRangeKey(params.cached) === params.fetchRangeKey
}

function handle304(params: {
  cached: Cached | null
  fetchRangeKey: string
}): 'rehydrate' | 'retry_without_etag' | 'fail' {
  if (
    params.cached &&
    isCachedPayloadUsable(params.cached) &&
    resolveCachedRangeKey(params.cached) === params.fetchRangeKey
  ) {
    return 'rehydrate'
  }
  return 'retry_without_etag'
}

function main() {
  console.log('verify-board-etag-304-rehydrate\n')

  const good: Cached = {
    preset: 'today',
    startDate: '2026-07-17',
    endDate: '2026-07-17',
    rangeKey: 'today|2026-07-17|2026-07-17',
    summary: { orderCount: 0 },
  }

  assert.equal(
    canRevalidateWithEtag({
      etag: '"abc"',
      cached: good,
      fetchRangeKey: 'today|2026-07-17|2026-07-17',
    }),
    true,
  )
  console.log('  ✓ 完整缓存可带 ETag 再验证')

  assert.equal(handle304({ cached: good, fetchRangeKey: 'today|2026-07-17|2026-07-17' }), 'rehydrate')
  console.log('  ✓ 304 + 可用缓存 => 恢复页面状态')

  assert.equal(
    handle304({
      cached: { ...good, rangeKey: 'yesterday|2026-07-16|2026-07-16' },
      fetchRangeKey: 'today|2026-07-17|2026-07-17',
    }),
    'retry_without_etag',
  )
  console.log('  ✓ 304 范围不匹配 => 无 ETag 重试')

  assert.equal(
    handle304({
      cached: { ...good, summary: null as unknown as Record<string, unknown> },
      fetchRangeKey: 'today|2026-07-17|2026-07-17',
    }),
    'retry_without_etag',
  )
  console.log('  ✓ 304 缓存损坏 => 不设 ready 空白页')

  assert.equal(
    canRevalidateWithEtag({
      etag: '"abc"',
      cached: good,
      fetchRangeKey: 'today|2026-07-17|2026-07-17',
      skipEtag: true,
    }),
    false,
  )
  console.log('  ✓ reloadLocalFresh 跳过 ETag')

  console.log('\nPASS')
}

main()
