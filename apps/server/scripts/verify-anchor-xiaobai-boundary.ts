/**
 * 小白午场/早场边界验收：
 * - 2026-06-18～06-30：XY 午场 14:30–18:00（专用路径）
 * - 2026-07-01+：小白改挂和田早场，专用路径关闭；时段窗口为 09:30–14:00（仅用于场次裁剪）
 *
 * npm run verify:anchor-xiaobai-boundary
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  isInXiaoBaiOrderSlot,
  isXiaoBaiAttributionActive,
} from '../src/services/anchor-xiaobai-slot.util'
import { isXiaoBaiOrderAttribution } from '../src/services/anchor-performance-attribution.service'
import { resolveShopSessionFallbackForDate, normalizeShopSessionKey } from '../src/services/shop-session-fallback.service'

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
    fail('6月 14:30:00 应归小白时段')
    failures++
  } else ok('6月 14:30:00 小白时段')
  if (!isInXiaoBaiOrderSlot(new Date(t175959))) {
    fail('6月 17:59:59 应归小白时段')
    failures++
  } else ok('6月 17:59:59 小白时段')
  if (isInXiaoBaiOrderSlot(new Date(t1800))) {
    fail('6月 18:00:00 不应归小白时段')
    failures++
  } else ok('6月 18:00:00 不归小白')
  if (isInXiaoBaiOrderSlot(new Date(t1801))) {
    fail('6月 18:01:00 不应归小白时段')
    failures++
  } else ok('6月 18:01:00 不归小白')

  if (!isXiaoBaiAttributionActive(t175959)) {
    fail('6月 17:59:59 应激活小白归属')
    failures++
  } else ok('6月 17:59:59 激活小白归属')
  if (isXiaoBaiAttributionActive(t1800)) {
    fail('6月 18:00:00 不应激活小白归属')
    failures++
  } else ok('6月 18:00:00 不激活小白归属')

  const xyView = view('XY祥钰珠宝')
  const plainXiangyuView = view('祥钰珠宝')
  const hetianView = view('和田雅玉')
  if (!isXiaoBaiOrderAttribution(xyView, t175959)) {
    fail('6月 XY祥钰 17:59:59 应归小白')
    failures++
  } else ok('6月 XY祥钰 17:59:59 归小白')
  if (isXiaoBaiOrderAttribution(xyView, t1800)) {
    fail('6月 XY祥钰 18:00:00 不应归小白')
    failures++
  } else ok('6月 XY祥钰 18:00:00 不归小白')
  if (isXiaoBaiOrderAttribution(plainXiangyuView, t175959)) {
    fail('普通祥钰在小白时段不应归小白')
    failures++
  } else ok('普通祥钰 17:59:59 不归小白')
  if (isXiaoBaiOrderAttribution(hetianView, t175959)) {
    fail('6月 和田雅玉在 XY 专用路径不应归小白')
    failures++
  } else ok('6月 和田雅玉 17:59:59 不走小白专用路径')

  // 7 月：专用路径关闭；时段窗口改为早场 09:30–14:00；归属靠固定回退/排班
  const tJul0930 = Date.parse('2026-07-02T09:30:00+08:00')
  const tJul1359 = Date.parse('2026-07-02T13:59:59+08:00')
  const tJul1400 = Date.parse('2026-07-02T14:00:00+08:00')
  if (!isInXiaoBaiOrderSlot(new Date(tJul0930))) {
    fail('7月 09:30:00 应在小白早场窗口')
    failures++
  } else ok('7月 09:30:00 小白早场窗口')
  if (!isInXiaoBaiOrderSlot(new Date(tJul1359))) {
    fail('7月 13:59:59 应在小白早场窗口')
    failures++
  } else ok('7月 13:59:59 小白早场窗口')
  if (isInXiaoBaiOrderSlot(new Date(tJul1400))) {
    fail('7月 14:00:00 不应在小白早场窗口')
    failures++
  } else ok('7月 14:00:00 不在小白早场窗口')
  if (isXiaoBaiOrderAttribution(xyView, tJul1400)) {
    fail('7月 XY 不得再走小白专用路径')
    failures++
  } else ok('7月 XY 关闭小白专用路径')
  if (isXiaoBaiOrderAttribution(hetianView, tJul0930)) {
    fail('7月 和田早场不走小白专用路径（改固定回退）')
    failures++
  } else ok('7月 和田早场不走专用路径')

  const hetian = normalizeShopSessionKey('和田雅玉')
  if (resolveShopSessionFallbackForDate(hetian, tJul0930)?.anchorName !== '小白') {
    fail('7月 和田 09:30 固定回退应归小白')
    failures++
  } else ok('7月 和田 09:30 固定回退→小白')
  if (resolveShopSessionFallbackForDate(hetian, tJul1400) != null) {
    fail('7月 和田 14:00 固定回退应为空')
    failures++
  } else ok('7月 和田 14:00 无固定回退')

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
