/**
 * Wave4: 批量归属与串行归属结果必须完全一致
 * npm run verify:canonical-attribution-batch-equivalence
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { loadBoardArtifactsForRange } from '../src/services/board-metrics.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import {
  remapViewsWithCanonicalAttribution,
  remapViewsWithCanonicalAttributionSequential,
} from '../src/services/canonical-order-attribution.service'
import { clearScheduleAttributionCache } from '../src/services/anchor-schedule-attribution.service'
import { clearManualAnchorOverrideCache } from '../src/services/order-anchor-manual-override.service'

config({ path: path.resolve(__dirname, '../.env') })

const START = process.env.START_DATE?.trim() || '2026-06-01'
const END = process.env.END_DATE?.trim() || '2026-06-07'

async function main() {
  console.log('verify:canonical-attribution-batch-equivalence')
  clearScheduleAttributionCache()
  clearManualAnchorOverrideCache()

  const { views, rawByMatch } = await loadBoardArtifactsForRange('custom', START, END)
  const sample = views.slice(0, Math.min(views.length, 400))
  const withRaw = attachRawByMatchToViews(sample, rawByMatch)

  clearScheduleAttributionCache()
  clearManualAnchorOverrideCache()
  const sequential = await remapViewsWithCanonicalAttributionSequential(withRaw)

  clearScheduleAttributionCache()
  clearManualAnchorOverrideCache()
  const batched = await remapViewsWithCanonicalAttribution(withRaw, {
    startDate: START,
    endDate: END,
    preload: true,
    concurrency: 16,
  })

  assert.equal(sequential.length, batched.length)
  for (let i = 0; i < sequential.length; i++) {
    const a = sequential[i]!
    const b = batched[i]!
    assert.equal(a.anchorId, b.anchorId, `anchorId @${i}`)
    assert.equal(a.anchorName, b.anchorName, `anchorName @${i}`)
    assert.equal(
      (a as { scheduleAttributionSource?: string }).scheduleAttributionSource,
      (b as { scheduleAttributionSource?: string }).scheduleAttributionSource,
      `source @${i}`,
    )
  }
  console.log(`compared ${sequential.length} views ${START}~${END}: OK`)
  console.log('verify:canonical-attribution-batch-equivalence PASS')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
