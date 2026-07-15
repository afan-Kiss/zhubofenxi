/**
 * Wave4: 验证快照/SWR 秒开语义 — npm run verify:board-second-load
 */
import assert from 'node:assert/strict'
import {
  isBoardSnapshotFingerprintCompatible,
  isBoardSnapshotStructurallyUsable,
  buildSnapshotBoardCacheStub,
  type BoardPresetSnapshotRecord,
} from '../src/services/board-preset-snapshot.service'
import { BUSINESS_CACHE_FINGERPRINT } from '../src/services/business-cache.service'
import { setBoardSnapshotFingerprintResolver } from '../src/services/board-preset-snapshot.service'
import {
  isBusinessDataGenerationEqual,
  cloneBusinessDataGeneration,
  getBusinessDataGenerationSync,
} from '../src/services/business-data-generation.service'
import { decideStatus } from '../src/services/after-sales-completeness.service'
import { inferBoardBuildPriority } from '../src/services/board-cache-build-queue.service'

setBoardSnapshotFingerprintResolver(() => BUSINESS_CACHE_FINGERPRINT)

function makeSnap(fp: string): BoardPresetSnapshotRecord {
  return {
    cacheKey: 'default|today|2026-07-15|2026-07-16',
    preset: 'today',
    startDate: '2026-07-15',
    endDate: '2026-07-16',
    summary: { totalGmv: 100, orderCount: 1 },
    anchorPerformanceSummary: { totalGmv: 100 },
    enrichedAnchorLeaderboard: [{ anchorName: '子杰', gmv: 100 }],
    blacklistedBuyerIds: [],
    orderCount: 1,
    lastBuiltAt: '2026-07-15T12:00:00.000Z',
    sourceSyncJobId: null,
    savedAt: '2026-07-15T12:00:00.000Z',
    businessCacheFingerprint: fp,
    payloadVersion: 'wave4-v1',
  }
}

async function main() {
  console.log('verify:board-second-load')

  assert.equal(isBoardSnapshotStructurallyUsable(null), false)
  assert.equal(isBoardSnapshotStructurallyUsable(makeSnap(BUSINESS_CACHE_FINGERPRINT)), true)
  assert.equal(
    isBoardSnapshotFingerprintCompatible(makeSnap(BUSINESS_CACHE_FINGERPRINT)),
    true,
  )
  assert.equal(isBoardSnapshotFingerprintCompatible(makeSnap('old-fp')), false)

  const stub = buildSnapshotBoardCacheStub(makeSnap(BUSINESS_CACHE_FINGERPRINT))
  assert.equal(stub.fallbackReason, 'disk_snapshot')
  assert.equal(stub.attributionAlgorithmVersion, BUSINESS_CACHE_FINGERPRINT)
  assert.ok(stub.summary)
  assert.ok((stub.enrichedAnchorLeaderboard?.length ?? 0) >= 1)

  const a = cloneBusinessDataGeneration(getBusinessDataGenerationSync())
  const b = cloneBusinessDataGeneration(a)
  assert.equal(isBusinessDataGenerationEqual(a, b), true)
  b.ordersGeneration += 1
  assert.equal(isBusinessDataGenerationEqual(a, b), false)

  assert.equal(inferBoardBuildPriority({ preset: 'today', interactive: true }), 'interactive')
  assert.equal(inferBoardBuildPriority({ preset: 'lastMonth' }), 'warmup-low')
  assert.equal(inferBoardBuildPriority({ preset: 'thisMonth' }), 'warmup-high')

  const open = decideStatus({
    pendingCount: 1,
    retryWaitCount: 0,
    runningCount: 0,
    blockedCount: 0,
    failedCount: 0,
  })
  assert.equal(open.status, 'partial')

  console.log('verify:board-second-load OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
