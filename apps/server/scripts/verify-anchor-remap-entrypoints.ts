/**
 * 主播归属 remap 入口一致性验收（只读，不改库）
 *
 * npm run verify:anchor-remap-entrypoints
 * npm run verify:anchor-remap-entrypoints -- --startDate=2026-07-01 --endDate=2026-07-05
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import {
  FOCUS_ORDERS,
  REMAP_VERIFY_ANCHORS,
  orderKeys,
  verifyAnchorRemapEntrypoints,
} from './lib/anchor-remap-entrypoints-verify.util'
import {
  fetchMetricDetailBundle,
} from './lib/metric-detail-attribution-verify.util'
import { buildAnchorDrill } from '../src/services/board-drill.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'

config({ path: path.resolve(__dirname, '../.env') })

function parseArgs(): { startDate: string; endDate: string } {
  let startDate = '2026-07-01'
  let endDate = '2026-07-05'
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--startDate=')) startDate = arg.slice('--startDate='.length).trim()
    if (arg.startsWith('--endDate=')) endDate = arg.slice('--endDate='.length).trim()
  }
  return { startDate, endDate }
}

async function main(): Promise<void> {
  const { startDate, endDate } = parseArgs()
  await bootstrapQualityBadCaseCache()

  console.log('\n=== 1. 验收范围 ===')
  console.log(`${startDate} ~ ${endDate}`)
  console.log(`入口: executeBoardLocalQuery / buildBoardMetricDetail / buildAnchorDrill`)
  console.log(`主播: 全店 + ${REMAP_VERIFY_ANCHORS.join(' / ')}`)

  const { fails, storeEffectiveGmv, storeEffectiveCount, expectedMap } =
    await verifyAnchorRemapEntrypoints({ startDate, endDate })

  console.log('\n=== 2. 全店 effectiveGmv ===')
  console.log(`valueRaw=¥${storeEffectiveGmv.toFixed(2)} matchedOrders=${storeEffectiveCount}`)

  console.log('\n=== 3. 重点订单入口归属 ===')
  const focusFails: string[] = []
  for (const orderNo of FOCUS_ORDERS) {
    const expected =
      expectedMap.get(orderNo) ??
      expectedMap.get(orderNo.replace(/^P/, '')) ??
      '—'
    const inStore = (
      await fetchMetricDetailBundle({
        metric: 'effectiveGmv',
        startDate,
        endDate,
      })
    ).rows.some((r) => orderKeys(orderNo).includes(r.orderNo || r.packageId || ''))

    const anchorChecks: string[] = []
    for (const anchorName of REMAP_VERIFY_ANCHORS) {
      const drawer = await fetchMetricDetailBundle({
        metric: 'effectiveGmv',
        startDate,
        endDate,
        anchorName,
      })
      const inDrawer = drawer.rows.some((r) =>
        orderKeys(orderNo).includes(r.orderNo || r.packageId || ''),
      )
      if (inDrawer) anchorChecks.push(anchorName)
    }

    console.log(
      `  ${orderNo}: expected=${expected} store=${inStore ? 'Y' : 'N'} anchors=[${anchorChecks.join(',') || '—'}]`,
    )

    if (expected !== '—' && expected !== '未归属') {
      if (!anchorChecks.includes(expected)) {
        focusFails.push(`${orderNo} 应在 ${expected} 入口，实际 anchors=[${anchorChecks.join(',') || '—'}]`)
      }
      for (const anchorName of REMAP_VERIFY_ANCHORS) {
        if (anchorName !== expected && anchorChecks.includes(anchorName)) {
          focusFails.push(`${orderNo} 不应在 ${anchorName} 入口`)
        }
      }
    }
  }

  console.log('\n=== 4. 三入口同池（effectiveGmv / orderCount）===')
  for (const anchorName of REMAP_VERIFY_ANCHORS) {
    const local = await executeBoardLocalQuery({
      preset: 'custom',
      startDate,
      endDate,
      anchorName,
      role: 'super_admin',
      username: 'verify-script',
    })
    const drawer = await fetchMetricDetailBundle({
      metric: 'effectiveGmv',
      startDate,
      endDate,
      anchorName,
    })
    const drill = await buildAnchorDrill({
      preset: 'custom',
      startDate,
      endDate,
      anchorName,
      page: 1,
      pageSize: 5000,
      role: 'super_admin',
      username: 'verify-script',
    })
    const localSummary = local.summary as Record<string, unknown>
    const drillStats = drill.stats as Record<string, unknown> | null
    console.log(
      `  ${anchorName}: localGmv=${Number(localSummary.effectiveGmv ?? 0).toFixed(2)}/${Number(localSummary.orderCount ?? 0)} drawer=${drawer.summary.valueRaw.toFixed(2)}/${drawer.summary.matchedOrders} drill=${Number(drillStats?.effectiveGmv ?? 0).toFixed(2)}/${Number(drillStats?.orderCount ?? 0)}`,
    )
  }

  const allFails = [...fails, ...focusFails]

  console.log('\n=== 验收 ===')
  if (allFails.length > 0) {
    console.log(`✗ FAIL: ${allFails.length} 项`)
    for (const f of allFails.slice(0, 40)) console.log(`  - ${f}`)
    if (allFails.length > 40) console.log(`  ... 另有 ${allFails.length - 40} 项`)
    process.exit(1)
  }
  console.log('✓ PASS: remap 入口一致，无 remap 前主播过滤风险')
}

main()
  .catch((err) => {
    console.error('FAIL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
