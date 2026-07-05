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
  buildRemappedAnchorMap,
  compareDrawerRowsToRemap,
  fetchMetricDetailBundle,
  verifyAnchorMetricDrawer,
} from './lib/metric-detail-attribution-verify.util'

config({ path: path.resolve(__dirname, '../.env') })

const START_DATE = process.env.START_DATE?.trim() || '2026-07-01'
const END_DATE = process.env.END_DATE?.trim() || '2026-07-05'
const METRIC = 'effectiveGmv' as const

const FOCUS_ORDERS = [
  'P798535644148309221',
  'P798524075193091331',
  'P798440490066093751',
  'P798440753968049541',
  'P798515495684105931',
]

const ANCHOR_CHECKS = [
  {
    anchorName: '子杰',
    mustInclude: [] as string[],
    mustExclude: ['P798535644148309221', 'P798440490066093751'],
  },
  {
    anchorName: '小白',
    mustInclude: ['P798535644148309221'],
    mustExclude: [] as string[],
  },
  {
    anchorName: '小艺',
    mustInclude: ['P798440490066093751'],
    mustExclude: [] as string[],
  },
]

function orderKeys(orderNo: string): string[] {
  const bare = orderNo.replace(/^P/, '')
  return [orderNo, bare]
}

async function main(): Promise<void> {
  await bootstrapQualityBadCaseCache()

  console.log('\n=== 1. 全店检查范围 ===')
  console.log(`metric=${METRIC} ${START_DATE} ~ ${END_DATE}`)

  const expectedMap = await buildRemappedAnchorMap({ startDate: START_DATE, endDate: END_DATE })
  const storeBundle = await fetchMetricDetailBundle({
    metric: METRIC,
    startDate: START_DATE,
    endDate: END_DATE,
  })

  console.log('\n=== 2. 全店 effectiveGmv 汇总 ===')
  console.log(`valueRaw: ${storeBundle.summary.valueRaw}`)
  console.log(`matchedOrders: ${storeBundle.summary.matchedOrders}`)
  console.log(`drawerRows: ${storeBundle.rows.length}`)

  const mismatches = compareDrawerRowsToRemap(storeBundle.rows, expectedMap)

  console.log('\n=== 3. 全店 row.anchorName 与 remap 后归属不一致 ===')
  if (mismatches.length === 0) {
    console.log('（无）')
  } else {
    for (const m of mismatches.slice(0, 30)) {
      console.log(JSON.stringify(m))
    }
    if (mismatches.length > 30) {
      console.log(`... 另有 ${mismatches.length - 30} 笔`)
    }
  }

  console.log('\n=== 4. 全店重点订单验收 ===')
  const focusFails: string[] = []
  for (const orderNo of FOCUS_ORDERS) {
    const row = storeBundle.rows.find((r) =>
      orderKeys(orderNo).includes(r.orderNo || r.packageId || ''),
    )
    const expected = expectedMap.get(orderNo) ?? expectedMap.get(orderNo.replace(/^P/, '')) ?? '—'
    const rowAnchor = row?.anchorName?.trim() || '（未出现在 drawer）'
    const wrongZiJie = rowAnchor === '子杰' && expected !== '子杰'
    const mismatch = row != null && rowAnchor !== expected
    const status = wrongZiJie || mismatch ? '✗' : '✓'
    console.log(
      `${status} ${orderNo}: drawer=${rowAnchor} expected=${expected} shop=${row?.liveAccountName ?? '—'}`,
    )
    if (wrongZiJie) {
      focusFails.push(`${orderNo}: 不应显示子杰（期望 ${expected}）`)
    } else if (mismatch) {
      focusFails.push(`${orderNo}: drawer=${rowAnchor} expected=${expected}`)
    }
  }

  console.log('\n=== 5. 主播维度 effectiveGmv drawer ===')
  const anchorFails: string[] = []
  for (const check of ANCHOR_CHECKS) {
    const fails = await verifyAnchorMetricDrawer({
      startDate: START_DATE,
      endDate: END_DATE,
      metric: METRIC,
      anchorName: check.anchorName,
      mustInclude: check.mustInclude,
      mustExclude: check.mustExclude,
    })
    const bundle = await fetchMetricDetailBundle({
      metric: METRIC,
      startDate: START_DATE,
      endDate: END_DATE,
      anchorName: check.anchorName,
    })
    const rowSum = bundle.rows.reduce((s, r) => s + (r.actualDealAmount ?? 0), 0)
    const status = fails.length === 0 ? '✓' : '✗'
    console.log(
      `${status} ${check.anchorName}: rows=${bundle.rows.length} valueRaw=${bundle.summary.valueRaw} rowSum=${rowSum.toFixed(2)}`,
    )
    if (fails.length > 0) {
      for (const f of fails) console.log(`  - ${f}`)
      anchorFails.push(...fails)
    }
  }

  console.log('\n=== 验收 ===')
  if (mismatches.length > 0 || focusFails.length > 0 || anchorFails.length > 0) {
    if (mismatches.length > 0) {
      console.log(`✗ FAIL: 全店 ${mismatches.length} 行 anchorName 与 remap 不一致`)
    }
    if (focusFails.length > 0) {
      console.log(`✗ FAIL: 全店重点订单 ${focusFails.length} 笔未通过`)
    }
    if (anchorFails.length > 0) {
      console.log(`✗ FAIL: 主播维度 ${anchorFails.length} 项未通过`)
    }
    process.exit(1)
  }
  console.log('✓ PASS: 全店 + 主播维度 metric drawer 归属一致')
}

main()
  .catch((err) => {
    console.error('FAIL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
