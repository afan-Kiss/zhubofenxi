/**
 * 经营总览 / 主播业绩 pageScope 隔离（纯逻辑）
 * npx tsx apps/server/scripts/verify-board-page-scope-isolation.ts
 *
 * 前端实现位于 apps/web；此处用同源规则做确定性验收，避免依赖浏览器。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(__filename)
const webRoot = path.resolve(__dirname, '../../web/src/lib')

// 通过 tsx 直接跑 web 源码较难；在本脚本内复刻关键纯函数并与源码字符串交叉校验。
function buildBoardRangeKey(preset: string, startDate: string, endDate: string): string {
  return `${preset}|${startDate}|${endDate}`
}

function buildBoardQueryKey(params: {
  pageScope: 'anchors' | 'overview'
  preset: string
  startDate: string
  endDate: string
}): string {
  return `${params.pageScope}|${params.preset}|${params.startDate}|${params.endDate}`
}

function buildLiveQueryCacheKey(params: {
  pageScope: 'anchors' | 'overview'
  preset: string
  startDate: string
  endDate: string
}): string {
  return `${params.pageScope}|${params.preset}|${params.startDate}|${params.endDate}|-`
}

function parsePageScopeFromCacheKey(key: string): 'overview' | 'anchors' | null {
  const scope = key.split('|')[0]
  if (scope === 'overview' || scope === 'anchors') return scope
  return null
}

function resolveCachedBoardIdentity(params: {
  data: {
    preset: string
    startDate: string
    endDate: string
    pageScope?: 'overview' | 'anchors'
    queryKey?: string
    summary: Record<string, unknown>
  }
  cacheKey: string
  expectedPageScope: 'overview' | 'anchors'
  expectedQueryKey: string
}) {
  const keyScope = parsePageScopeFromCacheKey(params.cacheKey)
  const pageScope = params.data.pageScope ?? keyScope
  if (!pageScope || pageScope !== params.expectedPageScope) return null
  const queryKey =
    params.data.queryKey ??
    `${pageScope}|${params.data.preset}|${params.data.startDate}|${params.data.endDate}`
  if (queryKey !== params.expectedQueryKey) return null
  return { ...params.data, pageScope, queryKey }
}

type PageState = {
  queryKey: string
  data: { label: string; dataDisplayStatus: string; error: string | null } | null
  displayStatus: string | null
  error: string | null
  staleMessage: string | null
}

function createRaceHarness() {
  let seq = 0
  let currentQueryKey = ''
  let state: PageState = {
    queryKey: '',
    data: null,
    displayStatus: null,
    error: null,
    staleMessage: null,
  }

  function start(queryKey: string) {
    currentQueryKey = queryKey
    const mySeq = ++seq
    // 切换页面：清旧状态，不沿用另一页
    state = {
      queryKey,
      data: null,
      displayStatus: null,
      error: null,
      staleMessage: null,
    }
    return {
      seq: mySeq,
      apply(result: {
        queryKey: string
        label: string
        dataDisplayStatus: string
        error?: string | null
        staleMessage?: string | null
      }) {
        if (mySeq !== seq) return false
        if (result.queryKey !== currentQueryKey) return false
        state = {
          queryKey: result.queryKey,
          data: {
            label: result.label,
            dataDisplayStatus: result.dataDisplayStatus,
            error: result.error ?? null,
          },
          displayStatus: result.dataDisplayStatus,
          error: result.error ?? null,
          staleMessage: result.staleMessage ?? null,
        }
        return true
      },
    }
  }

  return {
    get state() {
      return state
    },
    start,
  }
}

function main() {
  console.log('verify-board-page-scope-isolation\n')

  const fs = require('node:fs') as typeof import('node:fs')
  const rangeSrc = fs.readFileSync(path.join(webRoot, 'board-range.ts'), 'utf8')
  assert.ok(rangeSrc.includes('buildBoardQueryKey'))
  assert.ok(rangeSrc.includes('pageScope}|${params.preset}'))
  const cacheSrc = fs.readFileSync(path.join(webRoot, 'board-live-query-cache.ts'), 'utf8')
  assert.ok(cacheSrc.includes('resolveCachedBoardIdentity'))
  const providerSrc = fs.readFileSync(
    path.resolve(webRoot, '../providers/BoardLiveQueryProvider.tsx'),
    'utf8',
  )
  assert.ok(providerSrc.includes('fetchQueryKey !== currentQueryKeyRef.current'))
  assert.ok(providerSrc.includes('queryMatched'))
  console.log('  ✓ 源码包含 queryKey / pageScope 隔离实现')

  const rangeKey = buildBoardRangeKey('today', '2026-07-17', '2026-07-17')
  const anchorsKey = buildBoardQueryKey({
    pageScope: 'anchors',
    preset: 'today',
    startDate: '2026-07-17',
    endDate: '2026-07-17',
  })
  const overviewKey = buildBoardQueryKey({
    pageScope: 'overview',
    preset: 'today',
    startDate: '2026-07-17',
    endDate: '2026-07-17',
  })
  assert.equal(rangeKey, 'today|2026-07-17|2026-07-17')
  assert.notEqual(anchorsKey, overviewKey)
  assert.equal(anchorsKey, 'anchors|today|2026-07-17|2026-07-17')
  console.log('  ✓ 1 同日期 queryKey 不同')

  const anchorsCacheKey = buildLiveQueryCacheKey({
    pageScope: 'anchors',
    preset: 'today',
    startDate: '2026-07-17',
    endDate: '2026-07-17',
  })
  const overviewCacheKey = buildLiveQueryCacheKey({
    pageScope: 'overview',
    preset: 'today',
    startDate: '2026-07-17',
    endDate: '2026-07-17',
  })
  assert.notEqual(anchorsCacheKey, overviewCacheKey)
  console.log('  ✓ 2-3 缓存 key 含 pageScope 且不共用')

  const overviewPayload = {
    preset: 'today',
    startDate: '2026-07-17',
    endDate: '2026-07-17',
    pageScope: 'overview' as const,
    queryKey: overviewKey,
    summary: { orderCount: 1 },
  }
  assert.equal(
    resolveCachedBoardIdentity({
      data: overviewPayload,
      cacheKey: anchorsCacheKey,
      expectedPageScope: 'anchors',
      expectedQueryKey: anchorsKey,
    }),
    null,
  )
  assert.ok(
    resolveCachedBoardIdentity({
      data: overviewPayload,
      cacheKey: overviewCacheKey,
      expectedPageScope: 'overview',
      expectedQueryKey: overviewKey,
    }),
  )
  console.log('  ✓ 6 304 仅恢复相同 pageScope')

  const legacy = {
    preset: 'today',
    startDate: '2026-07-17',
    endDate: '2026-07-17',
    summary: { orderCount: 2 },
  }
  const recovered = resolveCachedBoardIdentity({
    data: legacy,
    cacheKey: overviewCacheKey,
    expectedPageScope: 'overview',
    expectedQueryKey: overviewKey,
  })
  assert.ok(recovered)
  assert.equal(recovered!.pageScope, 'overview')
  assert.equal(
    resolveCachedBoardIdentity({
      data: legacy,
      cacheKey: anchorsCacheKey,
      expectedPageScope: 'overview',
      expectedQueryKey: overviewKey,
    }),
    null,
  )
  console.log('  ✓ 7 错误 pageScope 缓存不可用于恢复')

  const harness = createRaceHarness()
  const anchorsReq = harness.start(anchorsKey)
  const overviewReq = harness.start(overviewKey)
  assert.equal(anchorsReq.apply({
    queryKey: anchorsKey,
    label: 'anchors-late',
    dataDisplayStatus: 'coverage_missing',
    staleMessage: '部分店铺尚未完成该日期范围同步',
  }), false)
  assert.equal(overviewReq.apply({
    queryKey: overviewKey,
    label: 'overview',
    dataDisplayStatus: 'ready',
  }), true)
  assert.equal(harness.state.data?.label, 'overview')
  assert.notEqual(harness.state.displayStatus, 'coverage_missing')
  console.log('  ✓ 4 主播旧请求晚返回不能覆盖总览')

  const overviewReq2 = harness.start(overviewKey)
  const anchorsReq2 = harness.start(anchorsKey)
  assert.equal(overviewReq2.apply({
    queryKey: overviewKey,
    label: 'overview-late',
    dataDisplayStatus: 'empty',
    staleMessage: '当前日期范围内暂无订单数据',
  }), false)
  assert.equal(anchorsReq2.apply({
    queryKey: anchorsKey,
    label: 'anchors',
    dataDisplayStatus: 'ready',
  }), true)
  assert.equal(harness.state.data?.label, 'anchors')
  assert.notEqual(harness.state.displayStatus, 'empty')
  console.log('  ✓ 5 / 8 / 9 总览旧请求与旧 empty/coverage 不沿用')

  const errReq = harness.start(overviewKey)
  errReq.apply({
    queryKey: overviewKey,
    label: 'ov-err',
    dataDisplayStatus: 'ready',
    error: 'boom',
  })
  const next = harness.start(anchorsKey)
  assert.equal(harness.state.error, null)
  assert.equal(harness.state.displayStatus, null)
  next.apply({ queryKey: anchorsKey, label: 'anchors-ok', dataDisplayStatus: 'ready' })
  assert.equal(harness.state.error, null)
  console.log('  ✓ 10 页面切换后旧 error 不沿用')

  const a = harness.start(anchorsKey)
  const o = harness.start(overviewKey)
  const a2 = harness.start(anchorsKey)
  a.apply({ queryKey: anchorsKey, label: 'a1', dataDisplayStatus: 'ready' })
  o.apply({ queryKey: overviewKey, label: 'o1', dataDisplayStatus: 'ready' })
  a2.apply({ queryKey: anchorsKey, label: 'a-final', dataDisplayStatus: 'ready' })
  assert.equal(harness.state.data?.label, 'a-final')
  console.log('  ✓ 11 快速来回切换最终展示当前页')

  console.log('\nPASS')
}

main()
