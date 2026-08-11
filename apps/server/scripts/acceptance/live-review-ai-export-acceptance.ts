/**
 * live_review 补齐 + AI export 纯函数验收
 * 覆盖：>108 场饿死、>800 remaining、prev-only 主播并集、partial 状态、3/31 月末 clamp、
 * detail merge、full 场次冷却/历史刷新、clipped 时长归属
 */
import assert from 'node:assert/strict'
import {
  liveReviewHistoricalRefreshSettingKey,
  shouldMarkAccountHistoricalRefreshDone,
  resolveHistoricalRefreshModeForAccount,
  countHistoricalRefreshDue,
  DEFAULT_DETAIL_COOLDOWN_MS,
  DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
  isCooldownRefreshDue,
  isHistoricalRefreshDue,
  liveRawNeedsLiveReview,
  liveReviewPartsForSelectReason,
  liveReviewPartsFullyComplete,
  liveReviewPartsNeedingFetch,
  mergeLiveReviewDetailFields,
  pickPrimaryCanonicalAnchorName,
  readLiveReviewPartsStatus,
  resolveLiveReviewSelectReason,
  selectLiveReviewEnrichCandidates,
  shiftMonthSameDay,
  sumClippedLiveHoursForAnchor,
  unionMapKeys,
  countSessionsTouchingAnchor,
  countLiveReviewRemainingMissing,
} from '../../src/services/xhs-api-sync/xhs-live-review-enrich.util'

function fullOkRaw(syncedAtIso: string) {
  return {
    _liveReviewOverview: { liveUv: 1 },
    _liveReviewTrafficCore: { joinUv: 1 },
    _liveReviewTransform: { paymentCount: 1 },
    _liveReviewNotes: [{ noteId: 'n1' }],
    _liveReviewNoteDetailAvailable: true,
    _liveReviewFullySyncedAt: syncedAtIso,
    _liveReviewSyncedAt: syncedAtIso,
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
  const many: Array<{ id: string; startTime: Date; endTime: Date | null; rawJson: unknown }> = []
  for (let i = 0; i < 120; i++) {
    const complete = i >= 40
    many.push({
      id: `s${String(i).padStart(3, '0')}`,
      startTime: new Date(Date.UTC(2026, 5, 1, 0, 0, i)),
      endTime: new Date(Date.UTC(2026, 5, 1, 2, 0, i)),
      rawJson: complete ? fullOkRaw('2026-06-01T00:00:00.000Z') : {},
    })
  }
  const shuffled = [...many].sort(() => Math.random() - 0.5)
  const picked = selectLiveReviewEnrichCandidates(shuffled, {
    mode: 'history_backfill',
    maxSessions: 36,
  })
  assert.equal(picked.length, 36)
  assert.ok(picked.every((r) => r.selectReason === 'missing_or_failed'))
  assert.ok(idsIncludes(picked, 's000'))
  assert.ok(!idsIncludes(picked, 's100'), 'history_backfill 不应选 full')
  const minStart = Math.min(...picked.map((r) => r.startTime!.getTime()))
  const oldestMissing = many
    .filter((r) => liveRawNeedsLiveReview(r.rawJson as Record<string, unknown>))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0]!
  assert.equal(minStart, oldestMissing.startTime.getTime())

  // 3) >800 remaining
  const over800: Array<{ rawJson: unknown }> = []
  for (let i = 0; i < 850; i++) {
    over800.push({
      rawJson: i < 800 ? fullOkRaw('2026-06-01T00:00:00.000Z') : { _liveReviewOverview: { liveUv: 1 } },
    })
  }
  assert.equal(countLiveReviewRemainingMissing(over800.slice(0, 800)), 0)
  assert.equal(countLiveReviewRemainingMissing(over800), 50)

  // 4) partial
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
  assert.deepEqual(liveReviewPartsNeedingFetch(st).sort(), ['note', 'overview', 'transform'].sort())

  // 5) detail merge
  const merged = mergeLiveReviewDetailFields(
    {
      overview: { a: 1 },
      trafficCore: { b: 2 },
      transform: { c: 3 },
      notes: [{ noteId: 'keep' }],
      coverList: [{ name: 'cover' }],
      noteTotal: 1,
      noteDetailAvailable: true,
    },
    {
      overview: { a: 1 },
      trafficCore: null,
      transform: null,
      notes: [],
      coverList: [],
      noteTotal: 0,
      noteDetailAvailable: false,
      syncedAt: '2026-08-11T00:00:00.000Z',
    },
  )
  assert.deepEqual(merged.trafficCore, { b: 2 })
  assert.deepEqual(merged.notes, [{ noteId: 'keep' }])

  // 6) prev-only 并集
  const keys = unionMapKeys(
    new Map([['小白', 1]]),
    new Map([
      ['小白', 2],
      ['飞云', 9],
    ]),
  )
  assert.ok(keys.includes('飞云'))

  // 7) primary
  assert.equal(
    pickPrimaryCanonicalAnchorName([
      { anchorName: '小白', overlapMinutes: 30 },
      { anchorName: '飞云', overlapMinutes: 90 },
    ]),
    '飞云',
  )

  // 8) full 场次：未到冷却不得进增量候选；到期必须进
  const now = Date.parse('2026-08-11T12:00:00+08:00')
  const todayKey = '2026-08-11'
  const yesterdayKey = '2026-08-10'
  const freshFull = {
    id: 'fresh',
    startTime: new Date('2026-08-11T02:00:00+08:00'),
    endTime: new Date('2026-08-11T05:00:00+08:00'),
    rawJson: fullOkRaw(new Date(now - 60 * 60 * 1000).toISOString()), // 1h ago < 6h
  }
  const staleFull = {
    id: 'stale',
    startTime: new Date('2026-08-11T01:00:00+08:00'),
    endTime: new Date('2026-08-11T03:00:00+08:00'),
    rawJson: fullOkRaw(new Date(now - 7 * 60 * 60 * 1000).toISOString()), // 7h ago
  }
  const oldDayFull = {
    id: 'oldday',
    startTime: new Date('2026-08-01T01:00:00+08:00'),
    endTime: new Date('2026-08-01T03:00:00+08:00'),
    rawJson: fullOkRaw(new Date(now - 10 * 60 * 60 * 1000).toISOString()),
  }

  assert.equal(
    isCooldownRefreshDue(freshFull.rawJson as Record<string, unknown>, {
      now,
      cooldownMs: DEFAULT_DETAIL_COOLDOWN_MS,
    }),
    false,
  )
  assert.equal(
    isCooldownRefreshDue(staleFull.rawJson as Record<string, unknown>, {
      now,
      cooldownMs: DEFAULT_DETAIL_COOLDOWN_MS,
    }),
    true,
  )

  const incr = selectLiveReviewEnrichCandidates([freshFull, staleFull, oldDayFull], {
    mode: 'incremental',
    maxSessions: 10,
    now,
    todayKey,
    yesterdayKey,
    cooldownMs: DEFAULT_DETAIL_COOLDOWN_MS,
  })
  assert.ok(!idsIncludes(incr, 'fresh'), '未到冷却不应进入')
  assert.ok(idsIncludes(incr, 'stale'), '到期 full 必须进入')
  assert.ok(!idsIncludes(incr, 'oldday'), '非今天/昨天/刚结束的 full 不进增量')
  assert.equal(incr.find((r) => r.id === 'stale')?.selectReason, 'cooldown_refresh')
  assert.deepEqual(
    liveReviewPartsForSelectReason('cooldown_refresh', readLiveReviewPartsStatus(staleFull.rawJson as Record<string, unknown>)),
    ['overview', 'traffic', 'transform', 'note'],
  )

  // 9) historical_refresh：full 到期可刷新；未到期不进
  const histFresh = {
    id: 'hf',
    startTime: new Date('2026-07-20T01:00:00+08:00'),
    endTime: new Date('2026-07-20T03:00:00+08:00'),
    rawJson: fullOkRaw(new Date(now - 2 * 60 * 60 * 1000).toISOString()),
  }
  const histStale = {
    id: 'hs',
    startTime: new Date('2026-07-15T01:00:00+08:00'),
    endTime: new Date('2026-07-15T03:00:00+08:00'),
    rawJson: fullOkRaw(new Date(now - 26 * 60 * 60 * 1000).toISOString()),
  }
  assert.equal(
    isHistoricalRefreshDue(histFresh.rawJson as Record<string, unknown>, {
      now,
      refreshIntervalMs: DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
    }),
    false,
  )
  assert.equal(
    resolveLiveReviewSelectReason(histStale, {
      mode: 'historical_refresh',
      now,
      refreshIntervalMs: DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
    }),
    'historical_refresh',
  )
  const histPicked = selectLiveReviewEnrichCandidates([histFresh, histStale], {
    mode: 'historical_refresh',
    maxSessions: 10,
    now,
    refreshIntervalMs: DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
  })
  assert.ok(idsIncludes(histPicked, 'hs'))
  assert.ok(!idsIncludes(histPicked, 'hf'))

  // 10) clipped 时长：跨主播不可整场给 primary
  const splitSession = {
    canonicalSegments: [
      {
        anchorName: '小白',
        clippedStartTime: '2026-08-01 10:00:00',
        clippedEndTime: '2026-08-01 12:00:00',
        clippedDurationMinutes: 120,
        overlapMinutes: 120,
      },
      {
        anchorName: '飞云',
        clippedStartTime: '2026-08-01 12:00:00',
        clippedEndTime: '2026-08-01 15:00:00',
        clippedDurationMinutes: 180,
        overlapMinutes: 180,
      },
    ],
    canonicalAnchorName: '飞云',
  }
  assert.equal(sumClippedLiveHoursForAnchor([splitSession], '小白'), 2)
  assert.equal(sumClippedLiveHoursForAnchor([splitSession], '飞云'), 3)
  assert.equal(countSessionsTouchingAnchor([splitSession], '小白'), 1)
  assert.notEqual(
    sumClippedLiveHoursForAnchor([splitSession], '飞云'),
    5,
    '禁止把整场 5h 全算给 primary',
  )

  // 11) 按账号独立历史刷新：A 完成不能阻止 B
  const nowMs = Date.parse('2026-08-11T12:00:00+08:00')
  const keyA = liveReviewHistoricalRefreshSettingKey('acct-A')
  const keyB = liveReviewHistoricalRefreshSettingKey('acct-B')
  assert.equal(keyA, 'liveReviewLastHistoricalRefreshAt:acct-A')
  assert.notEqual(keyA, keyB)
  const settingsAfterA = {
    [keyA]: new Date(nowMs).toISOString(),
    [keyB]: null,
  }
  assert.equal(
    resolveHistoricalRefreshModeForAccount({
      liveAccountId: 'acct-A',
      settings: settingsAfterA,
      nowMs,
      refreshIntervalMs: DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
    }),
    'incremental',
    'A 刚写完成时间 → incremental',
  )
  assert.equal(
    resolveHistoricalRefreshModeForAccount({
      liveAccountId: 'acct-B',
      settings: settingsAfterA,
      nowMs,
      refreshIntervalMs: DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
    }),
    'historical_refresh',
    'A 完成不得阻止 B 进入 historical_refresh',
  )

  // remainingRefreshDueCount > 0 不得标记完成
  const dueRows = [
    {
      id: 'd1',
      startTime: new Date('2026-07-20T01:00:00+08:00'),
      endTime: new Date('2026-07-20T03:00:00+08:00'),
      rawJson: fullOkRaw(new Date(nowMs - 26 * 60 * 60 * 1000).toISOString()),
    },
    {
      id: 'd2',
      startTime: new Date('2026-07-21T01:00:00+08:00'),
      endTime: new Date('2026-07-21T03:00:00+08:00'),
      rawJson: fullOkRaw(new Date(nowMs - 26 * 60 * 60 * 1000).toISOString()),
    },
  ]
  const dueCount = countHistoricalRefreshDue(dueRows, {
    now: nowMs,
    refreshIntervalMs: DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
  })
  assert.equal(dueCount, 2)
  assert.equal(shouldMarkAccountHistoricalRefreshDone(dueCount), false)
  assert.equal(shouldMarkAccountHistoricalRefreshDone(0), true)

  // 单次 maxSessions 截断：刷了 1 场后仍有 due → 不标记
  const afterOneBatch = selectLiveReviewEnrichCandidates(dueRows, {
    mode: 'historical_refresh',
    maxSessions: 1,
    now: nowMs,
    refreshIntervalMs: DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
  })
  assert.equal(afterOneBatch.length, 1)
  const stillDue = countHistoricalRefreshDue(
    dueRows.map((r) =>
      r.id === afterOneBatch[0]!.id
        ? {
            ...r,
            rawJson: fullOkRaw(new Date(nowMs).toISOString()), // 本批已刷
          }
        : r,
    ),
    { now: nowMs, refreshIntervalMs: DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS },
  )
  assert.equal(stillDue, 1)
  assert.equal(shouldMarkAccountHistoricalRefreshDone(stillDue), false)

  console.log('[acceptance] OK: live-review / AI-export pure helpers')
}

function idsIncludes(rows: Array<{ id: string }>, id: string) {
  return rows.some((r) => r.id === id)
}

main()
