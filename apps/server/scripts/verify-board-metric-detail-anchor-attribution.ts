/**
 * 经营总览指标明细抽屉主播归属验收（只读，不改库）
 *
 * npm run verify:board-metric-detail-anchor-attribution
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import {
  ANCHOR_DRAWER_NAMES,
  ANCHOR_MUST_EXCLUDE,
  ANCHOR_MUST_INCLUDE,
  DRAWER_VERIFY_METRICS,
  buildRemappedAnchorMap,
  compareDrawerRowsToRemap,
  fetchMetricDetailBundle,
  sumDrawerRowMetricValue,
  verifyAnchorMetricDrawer,
  verifyMetricDrawerAttribution,
} from './lib/metric-detail-attribution-verify.util'
import { buildAnchorMetricDetail } from '../src/services/anchor-metric-detail.service'
import type { BoardDrillOrderRow } from '../src/services/order-row-mapper.service'

config({ path: path.resolve(__dirname, '../.env') })

const START_DATE = process.env.START_DATE?.trim() || '2026-07-01'
const END_DATE = process.env.END_DATE?.trim() || '2026-07-05'

const FOCUS_ORDERS = [
  'P798535644148309221',
  'P798524075193091331',
  'P798440490066093751',
  'P798440753968049541',
  'P798515495684105931',
]

function orderKeys(orderNo: string): string[] {
  const bare = orderNo.replace(/^P/, '')
  return [orderNo, bare]
}

function countDuplicateOrderNos(rows: BoardDrillOrderRow[]): string[] {
  const seen = new Map<string, number>()
  const dupes: string[] = []
  for (const row of rows) {
    const key = (row.orderNo || row.packageId || row.orderId || '').trim()
    if (!key) continue
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    if (count === 2) dupes.push(key)
  }
  return dupes
}

async function main(): Promise<void> {
  await bootstrapQualityBadCaseCache()

  console.log('\n=== 1. 全店检查范围 ===')
  console.log(`${START_DATE} ~ ${END_DATE}`)
  console.log(`metrics: ${DRAWER_VERIFY_METRICS.join(', ')}`)

  const expectedMap = await buildRemappedAnchorMap({ startDate: START_DATE, endDate: END_DATE })
  const allMismatches: ReturnType<typeof compareDrawerRowsToRemap> = []

  console.log('\n=== 2. 全店各 metric drawer 归属 ===')
  for (const metric of DRAWER_VERIFY_METRICS) {
    const bundle = await fetchMetricDetailBundle({
      metric,
      startDate: START_DATE,
      endDate: END_DATE,
    })
    const mismatches = compareDrawerRowsToRemap(bundle.rows, expectedMap, metric)
    const dupes = countDuplicateOrderNos(bundle.rows)
    const status = mismatches.length === 0 && dupes.length === 0 ? '✓' : '✗'
    console.log(
      `${status} ${metric}: rows=${bundle.rows.length} valueRaw=${bundle.summary.valueRaw} matchedOrders=${bundle.summary.matchedOrders} mismatches=${mismatches.length} dupes=${dupes.length}`,
    )
    if (dupes.length > 0) {
      allMismatches.push({
        metric,
        orderNo: dupes[0],
        rowAnchor: '—',
        expectedAnchor: '—',
        liveAccountName: `重复P单:${dupes.slice(0, 3).join(',')}`,
      })
    }
    if (metric === 'gmv') {
      const rowSum = sumDrawerRowMetricValue(bundle.rows, 'gmv')
      if (Math.abs(rowSum - bundle.summary.valueRaw) > 0.02) {
        allMismatches.push({
          metric,
          orderNo: '—',
          rowAnchor: String(rowSum),
          expectedAnchor: String(bundle.summary.valueRaw),
          liveAccountName: 'gmv rows sum mismatch',
        })
      }
    }
    allMismatches.push(...mismatches)
  }

  if (allMismatches.length > 0) {
    console.log('\n错归样例（前 20）:')
    for (const m of allMismatches.slice(0, 20)) {
      console.log(JSON.stringify(m))
    }
  }

  console.log('\n=== 3. 全店 effectiveGmv 重点订单 ===')
  const effectiveBundle = await fetchMetricDetailBundle({
    metric: 'effectiveGmv',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  console.log(`全店 effectiveGmv valueRaw: ${effectiveBundle.summary.valueRaw}`)
  const focusFails: string[] = []
  for (const orderNo of FOCUS_ORDERS) {
    const row = effectiveBundle.rows.find((r) =>
      orderKeys(orderNo).includes(r.orderNo || r.packageId || ''),
    )
    const expected = expectedMap.get(orderNo) ?? expectedMap.get(orderNo.replace(/^P/, '')) ?? '—'
    const rowAnchor = row?.anchorName?.trim() || '（未出现在 drawer）'
    const wrongZiJie = rowAnchor === '子杰' && expected !== '子杰'
    const mismatch = row != null && rowAnchor !== expected && rowAnchor !== '（未出现在 drawer）'
    const status = wrongZiJie || mismatch ? '✗' : '✓'
    console.log(
      `${status} ${orderNo}: drawer=${rowAnchor} expected=${expected} shop=${row?.liveAccountName ?? '—'}`,
    )
    if (wrongZiJie) focusFails.push(`${orderNo}: 不应显示子杰（期望 ${expected}）`)
    else if (mismatch) focusFails.push(`${orderNo}: drawer=${rowAnchor} expected=${expected}`)
  }

  console.log('\n=== 4. 主播维度各 metric drawer（同池） ===')
  const anchorFails: string[] = []
  for (const anchorName of ANCHOR_DRAWER_NAMES) {
    console.log(`\n--- ${anchorName} ---`)
    for (const metric of DRAWER_VERIFY_METRICS) {
      const fails = await verifyAnchorMetricDrawer({
        startDate: START_DATE,
        endDate: END_DATE,
        metric,
        anchorName,
        mustInclude:
          metric === 'effectiveGmv'
            ? ANCHOR_MUST_INCLUDE[anchorName as keyof typeof ANCHOR_MUST_INCLUDE]
            : undefined,
        mustExclude:
          metric === 'effectiveGmv'
            ? ANCHOR_MUST_EXCLUDE[anchorName as keyof typeof ANCHOR_MUST_EXCLUDE]
            : undefined,
        remappedAnchorMap: expectedMap,
      })
      const bundle = await fetchMetricDetailBundle({
        metric,
        startDate: START_DATE,
        endDate: END_DATE,
        anchorName,
      })
      const rowMetric = sumDrawerRowMetricValue(bundle.rows, metric)
      const status = fails.length === 0 ? '✓' : '✗'
      console.log(
        `${status} ${metric}: rows=${bundle.rows.length} pagination=${bundle.paginationTotal} valueRaw=${bundle.summary.valueRaw} rowMetric=${rowMetric}`,
      )
      if (fails.length > 0) {
        for (const f of fails.slice(0, 5)) console.log(`  - ${f}`)
        anchorFails.push(...fails)
      }
    }
  }

  console.log('\n=== 4. 主播签收率详情 Tab 去重 ===')
  for (const anchorName of ANCHOR_DRAWER_NAMES) {
    const detail = await buildAnchorMetricDetail({
      anchorId: anchorName,
      metric: 'signRate',
      startDate: START_DATE,
      endDate: END_DATE,
      tab: 'signed',
      page: 1,
      pageSize: 100,
      role: 'super_admin',
      username: 'verify-script',
    })
    const signedTab = detail.tabs?.find((t) => t.key === 'signed')
    const unsignedTab = detail.tabs?.find((t) => t.key === 'unsigned')
    if (signedTab && signedTab.count === detail.summary.matchedOrders) {
      console.log(`✓ ${anchorName} signRate signed tab ${signedTab.count} === matchedOrders`)
    } else {
      anchorFails.push(
        `${anchorName} signRate signed tab ${signedTab?.count ?? '—'} !== matchedOrders ${detail.summary.matchedOrders}`,
      )
    }
    if (
      signedTab &&
      unsignedTab &&
      signedTab.count + unsignedTab.count === detail.summary.totalOrders
    ) {
      console.log(`✓ ${anchorName} signRate tabs 合计 === totalOrders ${detail.summary.totalOrders}`)
    } else {
      anchorFails.push(
        `${anchorName} signRate tabs 合计 !== totalOrders ${detail.summary.totalOrders}`,
      )
    }
    const dupes = countDuplicateOrderNos(detail.rows)
    if (dupes.length === 0) {
      console.log(`✓ ${anchorName} signRate signed rows 无重复 P 单`)
    } else {
      anchorFails.push(`${anchorName} signRate 重复 P 单: ${dupes.slice(0, 3).join(', ')}`)
    }
  }

  console.log('\n=== 验收 ===')
  if (allMismatches.length > 0 || focusFails.length > 0 || anchorFails.length > 0) {
    if (allMismatches.length > 0) {
      console.log(`✗ FAIL: 全店 ${allMismatches.length} 行 anchorName 与 remap 不一致`)
    }
    if (focusFails.length > 0) {
      console.log(`✗ FAIL: effectiveGmv 重点订单 ${focusFails.length} 笔未通过`)
    }
    if (anchorFails.length > 0) {
      console.log(`✗ FAIL: 主播维度 ${anchorFails.length} 项未通过`)
    }
    process.exit(1)
  }
  console.log('✓ PASS: 全店 + 主播维度全部 metric drawer 归属与同池验收通过')
}

main()
  .catch((err) => {
    console.error('FAIL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
