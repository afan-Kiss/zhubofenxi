/**
 * 小白 14:30–18:00 边界验收（18:00 不归小白）
 *
 * npm run verify:anchor-xiaobai-boundary
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  isInXiaoBaiOrderSlot,
  isXiaoBaiAttributionActive,
} from '../src/services/anchor-xiaobai-slot.util'
import { isXiaoBaiOrderAttribution } from '../src/services/anchor-performance-attribution.service'

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string): void {
  console.error(`  ✗ FAIL: ${msg}`)
}

function view(liveAccountName: string): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    liveAccountName,
    raw: { liveAccountName },
  } as AnalyzedOrderView & { raw?: Record<string, unknown> }
}

async function main(): Promise<void> {
  console.log('verify-anchor-xiaobai-boundary\n')
  let failures = 0

  const t1430 = Date.parse('2026-06-18T14:30:00+08:00')
  const t175959 = Date.parse('2026-06-18T17:59:59+08:00')
  const t1800 = Date.parse('2026-06-18T18:00:00+08:00')
  const t1801 = Date.parse('2026-06-18T18:01:00+08:00')

  if (!isInXiaoBaiOrderSlot(new Date(t1430))) {
    fail('14:30:00 应归小白时段')
    failures++
  } else ok('14:30:00 小白时段')
  if (!isInXiaoBaiOrderSlot(new Date(t175959))) {
    fail('17:59:59 应归小白时段')
    failures++
  } else ok('17:59:59 小白时段')
  if (isInXiaoBaiOrderSlot(new Date(t1800))) {
    fail('18:00:00 不应归小白时段')
    failures++
  } else ok('18:00:00 不归小白')
  if (isInXiaoBaiOrderSlot(new Date(t1801))) {
    fail('18:01:00 不应归小白时段')
    failures++
  } else ok('18:01:00 不归小白')

  if (!isXiaoBaiAttributionActive(t175959)) {
    fail('17:59:59 应激活小白归属')
    failures++
  } else ok('17:59:59 激活小白归属')
  if (isXiaoBaiAttributionActive(t1800)) {
    fail('18:00:00 不应激活小白归属')
    failures++
  } else ok('18:00:00 不激活小白归属')

  const xyView = view('XY祥钰珠宝')
  const hetianView = view('和田雅玉')
  if (!isXiaoBaiOrderAttribution(xyView, t175959)) {
    fail('祥钰 17:59:59 应归小白')
    failures++
  } else ok('祥钰 17:59:59 归小白')
  if (isXiaoBaiOrderAttribution(xyView, t1800)) {
    fail('祥钰 18:00:00 不应归小白')
    failures++
  } else ok('祥钰 18:00:00 不归小白')
  if (isXiaoBaiOrderAttribution(hetianView, t175959)) {
    fail('非祥钰店铺在小白时段不应归小白')
    failures++
  } else ok('非祥钰店铺 17:59:59 不归小白')

  if (failures > 0) {
    console.log(`\nFAIL (${failures} 项)`)
    process.exit(1)
  }
  console.log('\nPASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
