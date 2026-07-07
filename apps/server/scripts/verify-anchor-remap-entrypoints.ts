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
  verifyFocusOrdersInPools,
} from './lib/anchor-remap-entrypoints-verify.util'
import {
  fetchMetricDetailBundle,
} from './lib/metric-detail-attribution-verify.util'
import { buildAnchorDrill } from '../src/services/board-drill.service'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
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
  const focusPoolFails = await verifyFocusOrdersInPools({ startDate, endDate, expectedMap })

  console.log('\n=== 2. 全店 effectiveGmv ===')
  console.log(`valueRaw=¥${storeEffectiveGmv.toFixed(2)} 有效成交笔数=${storeEffectiveCount}`)

  console.log('\n=== 3. 重点订单入口归属（日志） ===')
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
      `  ${orderNo}: expected=${expected} storeEffective=${inStore ? 'Y' : 'N'} effectiveGmvAnchors=[${anchorChecks.join(',') || '—'}]`,
    )
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
      `  ${anchorName}: localGmv=${Number(localSummary.effectiveGmv ?? 0).toFixed(2)} drawer=${drawer.summary.valueRaw.toFixed(2)}/${drawer.rows.length} drill=${Number(drillStats?.effectiveGmv ?? 0).toFixed(2)}`,
    )
  }

  const allFails = [...fails, ...focusPoolFails]

  const localAll = await executeBoardLocalQuery({
    preset: 'custom',
    startDate,
    endDate,
    role: 'super_admin',
    username: 'verify-script',
  })

  console.log('\n=== 5. 经营缓存 anchorLeaderboard vs 在线重算 ===')
  const cacheFails: string[] = []
  const localRows = (localAll.anchorLeaderboard ?? []) as Array<Record<string, unknown>>
  const hasPaidOrders = localRows.some(
    (r) => Number(r.orderCount ?? r.paidOrderCount ?? 0) > 0,
  )
  if (!hasPaidOrders) {
    console.log('⚠ 跳过：验收范围内无支付订单，请在生产环境复验缓存一致性')
  } else {
    await buildAndSetBusinessBoardCache({
      preset: 'custom',
      startDate,
      endDate,
    })
    const cached = await buildAndSetBusinessBoardCache({
      preset: 'custom',
      startDate,
      endDate,
    })
    for (const localRow of localRows) {
      const name = String(localRow.anchorName ?? '')
      const cacheRow = (cached.anchorLeaderboard ?? []).find((r) => String(r.anchorName) === name)
      if (!cacheRow) {
        if (Number(localRow.orderCount ?? localRow.paidOrderCount ?? 0) > 0) {
          cacheFails.push(`缓存缺少主播行 ${name}`)
        }
        continue
      }
      const localGmv = Number(localRow.gmv ?? localRow.totalGmv ?? 0)
      const cacheGmv = Number(cacheRow.gmv ?? cacheRow.totalGmv ?? 0)
      const localCnt = Number(localRow.orderCount ?? localRow.paidOrderCount ?? 0)
      const cacheCnt = Number(cacheRow.orderCount ?? cacheRow.paidOrderCount ?? 0)
      const localQr = Number(localRow.qualityReturnCount ?? 0)
      const cacheQr = Number(cacheRow.qualityReturnCount ?? 0)
      if (Math.abs(localGmv - cacheGmv) > 0.01) {
        cacheFails.push(`${name} gmv 缓存=${cacheGmv} 在线=${localGmv}`)
      }
      if (localCnt !== cacheCnt) {
        cacheFails.push(`${name} orderCount 缓存=${cacheCnt} 在线=${localCnt}`)
      }
      if (localQr !== cacheQr) {
        cacheFails.push(`${name} qualityReturnCount 缓存=${cacheQr} 在线=${localQr}`)
      }
    }
    if (cacheFails.length === 0) {
      console.log('✓ PASS: 缓存 anchorLeaderboard 与在线重算一致')
    } else {
      for (const f of cacheFails) console.log(`✗ FAIL: ${f}`)
    }
  }

  const finalFails = [...allFails, ...cacheFails]

  console.log('\n=== 验收 ===')
  if (finalFails.length > 0) {
    console.log(`✗ FAIL: ${finalFails.length} 项`)
    for (const f of finalFails.slice(0, 40)) console.log(`  - ${f}`)
    if (finalFails.length > 40) console.log(`  ... 另有 ${finalFails.length - 40} 项`)
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
