/**
 * live_review 补齐 + AI export 纯函数验收
 * 覆盖：>108 场饿死、>800 remaining、prev-only 主播并集、partial 状态、3/31 月末 clamp、detail merge
 */
import assert from 'node:assert/strict'
import {
  countLiveReviewRemainingMissing,
  liveRawNeedsLiveReview,
  liveReviewPartsFullyComplete,
  liveReviewPartsNeedingFetch,
  mergeLiveReviewDetailFields,
  pickPrimaryCanonicalAnchorName,
  readLiveReviewPartsStatus,
  selectLiveReviewEnrichCandidates,
  shiftMonthSameDay,
  unionMapKeys,
} from '../../src/services/xhs-api-sync/xhs-live-review-enrich.util'

function fullOkRaw() {
  return {
    _liveReviewOverview: { liveUv: 1 },
    _liveReviewTrafficCore: { joinUv: 1 },
    _liveReviewTransform: { paymentCount: 1 },
    _liveReviewNotes: [{ noteId: 'n1' }],
    _liveReviewNoteDetailAvailable: true,
    _liveReviewPartsStatus: {
      overview: 'ok',
      traffic: 'ok',
      transform: 'ok',
      note: 'ok',
    },
  }
}

function main() {
  // 1) 月末溢出 clamp：3月31日 → 2月28/29
  assert.equal(shiftMonthSameDay('2026-03-31', -1), '2026-02-28')
  assert.equal(shiftMonthSameDay('2024-03-31', -1), '2024-02-29')
  assert.equal(shiftMonthSameDay('2026-08-11', -1), '2026-07-11')
  assert.equal(shiftMonthSameDay('2026-01-31', -1), '2025-12-31')

  // 2) >108 场：desc+take 会饿死旧场；asc 必须先拿最老缺失
  const many: Array<{ id: string; startTime: Date; rawJson: unknown }> = []
  for (let i = 0; i < 120; i++) {
    const complete = i >= 40 // 最老 40 缺详情，后面 80 已完整
    many.push({
      id: `s${String(i).padStart(3, '0')}`,
      startTime: new Date(Date.UTC(2026, 5, 1, 0, 0, i)), // 严格递增
      rawJson: complete ? fullOkRaw() : {},
    })
  }
  // 打乱再测选择器（不依赖输入顺序）
  const shuffled = [...many].sort(() => Math.random() - 0.5)
  const picked = selectLiveReviewEnrichCandidates(shuffled, {
    mode: 'history_backfill',
    maxSessions: 36,
  })
  assert.equal(picked.length, 36)
  assert.ok(
    picked.every((r) => liveRawNeedsLiveReview((r.rawJson as object) as Record<string, unknown>)),
  )
  // 最老优先：前几个 id 应是 s000..（缺详情的最老）
  const ids = picked.map((r) => r.id)
  assert.ok(ids.includes('s000'), `应包含最老缺失 s000，实际 ${ids.slice(0, 5).join(',')}`)
  assert.ok(!ids.includes('s100'), '不应先啃已完整的新场次')
  // 若错误用 desc，会偏向大 id；这里断言最小 startTime 在 picked 中
  const minStart = Math.min(...picked.map((r) => r.startTime!.getTime()))
  const oldestMissing = many.filter((r) => liveRawNeedsLiveReview(r.rawJson as Record<string, unknown>))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0]!
  assert.equal(minStart, oldestMissing.startTime.getTime())

  // 3) >800 场：截断扫描会误判完成；全量 count 必须 >0
  const over800: Array<{ rawJson: unknown }> = []
  for (let i = 0; i < 850; i++) {
    over800.push({
      rawJson:
        i < 800
          ? fullOkRaw()
          : { _liveReviewOverview: { liveUv: 1 } }, // 仅 overview → 仍 missing
    })
  }
  const truncated = over800.slice(0, 800)
  assert.equal(countLiveReviewRemainingMissing(truncated), 0, '截断 800 会看不见尾部缺失')
  assert.equal(countLiveReviewRemainingMissing(over800), 50, '全量必须数到 50')
  assert.ok(countLiveReviewRemainingMissing(over800) > 0)
  // 完成条件：remainingMissingCount===0
  assert.equal(countLiveReviewRemainingMissing(over800.map(() => ({ rawJson: fullOkRaw() }))), 0)

  // 4) partial：单 core 成功 ≠ full complete，仍需继续补
  const partialRaw = {
    _liveReviewTrafficCore: { joinUv: 9 },
    _liveReviewPartsStatus: {
      overview: 'missing',
      traffic: 'ok',
      transform: 'failed',
      note: 'missing',
    },
  }
  const st = readLiveReviewPartsStatus(partialRaw)
  assert.equal(liveReviewPartsFullyComplete(st), false)
  assert.ok(liveRawNeedsLiveReview(partialRaw))
  const need = liveReviewPartsNeedingFetch(st)
  assert.deepEqual(need.sort(), ['note', 'overview', 'transform'].sort())

  // 5) detail 部分刷新不得用 null/[] 覆盖成功字段
  const prevDetail = {
    overview: { a: 1 },
    trafficCore: { b: 2 },
    transform: { c: 3 },
    notes: [{ noteId: 'keep' }],
    coverList: [{ name: 'cover' }],
    noteTotal: 1,
    noteDetailAvailable: true,
  }
  const merged = mergeLiveReviewDetailFields(prevDetail, {
    overview: { a: 1 },
    trafficCore: null,
    transform: null,
    notes: [],
    coverList: [],
    noteTotal: 0,
    noteDetailAvailable: false,
    syncedAt: '2026-08-11T00:00:00.000Z',
  })
  assert.deepEqual(merged.trafficCore, { b: 2 })
  assert.deepEqual(merged.transform, { c: 3 })
  assert.deepEqual(merged.notes, [{ noteId: 'keep' }])
  assert.deepEqual(merged.coverList, [{ name: 'cover' }])
  assert.equal(merged.noteTotal, 1)
  assert.equal(merged.noteDetailAvailable, true)
  assert.equal(merged.syncedAt, '2026-08-11T00:00:00.000Z')

  // 6) prev-only 主播并集：上月有、本月 0 必须保留
  const cur = new Map<string, unknown>([['小白', { gmv: 1 }]])
  const prev = new Map<string, unknown>([
    ['小白', { gmv: 2 }],
    ['飞云', { gmv: 9 }],
  ])
  const keys = unionMapKeys(cur, prev)
  assert.ok(keys.includes('飞云'), 'prev-only 主播必须出现')
  assert.ok(keys.includes('小白'))
  // 模拟导出行：本月 0
  const rows = keys.map((name) => {
    const c = (cur.get(name) as { gmv?: number } | undefined)?.gmv ?? 0
    const p = (prev.get(name) as { gmv?: number } | undefined)?.gmv ?? 0
    return { name, current: c, previous: p, delta: c - p }
  })
  const feiyun = rows.find((r) => r.name === '飞云')!
  assert.equal(feiyun.current, 0)
  assert.equal(feiyun.previous, 9)
  assert.equal(feiyun.delta, -9)

  // 7) canonical 主段：最长 overlap
  assert.equal(
    pickPrimaryCanonicalAnchorName([
      { anchorName: '小白', overlapMinutes: 30 },
      { anchorName: '飞云', overlapMinutes: 90 },
    ]),
    '飞云',
  )
  assert.equal(pickPrimaryCanonicalAnchorName([]), null)

  console.log('[acceptance] OK: live-review / AI-export pure helpers')
}

main()
