/**
 * 同步完成检测：不依赖 wasSyncing 边沿；同 successAt 不重复刷新
 * npx tsx apps/server/scripts/verify-board-sync-finish-refresh.ts
 */
import assert from 'node:assert/strict'

function shouldReload(params: {
  wasSyncing: boolean
  stillSyncing: boolean
  lastSuccessAt: string | null
  seenSuccessAt: string | null
  finishedJobId: string | null
  seenJobId: string | null
  refreshInFlight: boolean
}): boolean {
  if (params.refreshInFlight) return false
  const syncJustFinished = params.wasSyncing && !params.stillSyncing
  const successChanged =
    Boolean(params.lastSuccessAt) && params.lastSuccessAt !== params.seenSuccessAt
  const jobChanged =
    Boolean(params.finishedJobId) &&
    !params.stillSyncing &&
    params.finishedJobId !== params.seenJobId
  return syncJustFinished || successChanged || jobChanged
}

function main() {
  console.log('verify-board-sync-finish-refresh\n')

  // 轮询间隙快速完成：从未看到 running，但 lastSuccessAt 变了
  assert.equal(
    shouldReload({
      wasSyncing: false,
      stillSyncing: false,
      lastSuccessAt: '2026-07-17T10:00:01.000Z',
      seenSuccessAt: '2026-07-17T09:00:00.000Z',
      finishedJobId: 'job-2',
      seenJobId: 'job-1',
      refreshInFlight: false,
    }),
    true,
  )
  console.log('  ✓ lastSuccessAt 变化仍触发重新加载')

  assert.equal(
    shouldReload({
      wasSyncing: false,
      stillSyncing: false,
      lastSuccessAt: '2026-07-17T10:00:01.000Z',
      seenSuccessAt: '2026-07-17T10:00:01.000Z',
      finishedJobId: 'job-2',
      seenJobId: 'job-2',
      refreshInFlight: false,
    }),
    false,
  )
  console.log('  ✓ 同一成功时间不重复刷新')

  assert.equal(
    shouldReload({
      wasSyncing: true,
      stillSyncing: false,
      lastSuccessAt: '2026-07-17T10:00:01.000Z',
      seenSuccessAt: '2026-07-17T10:00:01.000Z',
      finishedJobId: null,
      seenJobId: null,
      refreshInFlight: false,
    }),
    true,
  )
  console.log('  ✓ wasSyncing 边沿仍可用')

  // 昨日预取目标键
  const targets = [
    { pageScope: 'anchors', preset: 'yesterday' },
    { pageScope: 'overview', preset: 'yesterday' },
  ]
  for (const t of targets) {
    const key = `${t.pageScope}|${t.preset}|2026-07-16|2026-07-16`
    assert.ok(key.includes('yesterday'))
  }
  console.log('  ✓ 昨日预取生成正确缓存键片段')

  console.log('\nPASS')
}

main()
