/**
 * 线下 GMV 生效日边界验收
 * OFFLINE_DEAL_SKIP_CACHE_INVALIDATE=1 npx tsx apps/server/scripts/accept-offline-gmv-effective-date.ts
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  createOfflineDeal,
  offlineDealCountsInPayGmv,
  offlineDealToAnalyzedView,
  splitGmvByDealSource,
  updateOfflineDealStatus,
} from '../src/services/offline-deal.service'
import {
  initializeSystemAnchors,
  refreshAnchorConfigCache,
  findYifanManualSystemAnchor,
  getAnchorConfigSync,
} from '../src/services/anchor.service'
import {
  OFFLINE_GMV_EFFECTIVE_FROM_DATE,
  isOfflineDealAtEffectiveForGmv,
  rangeIncludesOfflineGmvSurface,
} from '../src/config/offline-gmv.constants'

async function main() {
  console.log('accept-offline-gmv-effective-date')
  await initializeSystemAnchors()
  await refreshAnchorConfigCache()
  const yifan = findYifanManualSystemAnchor(getAnchorConfigSync())
  assert.ok(yifan)

  assert.equal(OFFLINE_GMV_EFFECTIVE_FROM_DATE, '2026-07-14')
  assert.equal(isOfflineDealAtEffectiveForGmv(new Date('2026-07-13T23:59:59.999+08:00')), false)
  assert.equal(isOfflineDealAtEffectiveForGmv(new Date('2026-07-14T00:00:00.000+08:00')), true)
  assert.equal(rangeIncludesOfflineGmvSurface('2026-06-01', '2026-06-30'), false)
  assert.equal(rangeIncludesOfflineGmvSurface('2026-07-01', '2026-07-13'), false)
  assert.equal(rangeIncludesOfflineGmvSurface('2026-07-01', '2026-07-14'), true)
  assert.equal(rangeIncludesOfflineGmvSurface('2026-07-14', '2026-07-31'), true)

  const stamp = Date.now()
  const before = await createOfflineDeal({
    amountYuan: 100,
    dealAt: '2026-07-13T23:59:59+08:00',
    externalKey: `accept-off-before-${stamp}`,
    idempotencyKey: `accept-off-before-${stamp}`,
    status: 'confirmed',
    operator: 'accept-offline-gmv',
  })
  const after = await createOfflineDeal({
    amountYuan: 200,
    dealAt: '2026-07-14T00:00:00+08:00',
    externalKey: `accept-off-after-${stamp}`,
    idempotencyKey: `accept-off-after-${stamp}`,
    status: 'confirmed',
    operator: 'accept-offline-gmv',
  })

  assert.equal(before.anchorId, yifan.id)
  assert.equal(after.anchorId, yifan.id)

  const beforeRow = await prisma.offlineDeal.findUniqueOrThrow({ where: { id: before.id } })
  const afterRow = await prisma.offlineDeal.findUniqueOrThrow({ where: { id: after.id } })
  assert.equal(offlineDealCountsInPayGmv(beforeRow), false)
  assert.equal(offlineDealCountsInPayGmv(afterRow), true)

  const views = [offlineDealToAnalyzedView(beforeRow), offlineDealToAnalyzedView(afterRow)]
  const split = splitGmvByDealSource(views)
  assert.equal(split.offlineGmv, 200)
  assert.equal(split.offlineDealCount, 1)
  assert.equal(views[0]!.includedInGmv, false)
  assert.ok(String(views[0]!.gmvExcludeReason ?? '').includes('不计入业绩'))

  // cleanup
  await updateOfflineDealStatus({
    dealId: before.id,
    status: 'voided',
    operator: 'accept-offline-gmv',
    reason: 'cleanup',
  })
  await updateOfflineDealStatus({
    dealId: after.id,
    status: 'voided',
    operator: 'accept-offline-gmv',
    reason: 'cleanup',
  })

  console.log('PASS accept-offline-gmv-effective-date')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
