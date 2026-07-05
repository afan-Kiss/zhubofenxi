/**
 * 经营总览指标明细抽屉主播归属验收（只读，不改库）
 *
 * npm run verify:board-metric-detail-anchor-attribution
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import {
  buildRemappedAnchorMap,
  compareDrawerRowsToRemap,
  fetchMetricDetailRows,
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

function orderKeys(orderNo: string): string[] {
  const bare = orderNo.replace(/^P/, '')
  return [orderNo, bare]
}

async function main(): Promise<void> {
  await bootstrapQualityBadCaseCache()

  console.log('\n=== 1. 检查范围 ===')
  console.log(`metric=${METRIC} ${START_DATE} ~ ${END_DATE}`)

  const expectedMap = await buildRemappedAnchorMap({ startDate: START_DATE, endDate: END_DATE })
  const rows = await fetchMetricDetailRows({
    metric: METRIC,
    startDate: START_DATE,
    endDate: END_DATE,
  })

  const detail = await buildBoardMetricDetail({
    metric: METRIC,
    preset: 'custom',
    startDate: START_DATE,
    endDate: END_DATE,
    page: 1,
    pageSize: 100,
    role: 'super_admin',
    username: 'verify-script',
  })

  console.log('\n=== 2. effectiveGmv 汇总 ===')
  console.log(`valueRaw: ${detail.summary.valueRaw}`)
  console.log(`matchedOrders: ${detail.summary.matchedOrders}`)
  console.log(`drawerRows: ${rows.length}`)

  const mismatches = compareDrawerRowsToRemap(rows, expectedMap)

  console.log('\n=== 3. row.anchorName 与 remap 后归属不一致 ===')
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

  console.log('\n=== 4. 重点订单验收 ===')
  const focusFails: string[] = []
  for (const orderNo of FOCUS_ORDERS) {
    const row = rows.find((r) => orderKeys(orderNo).includes(r.orderNo || r.packageId || ''))
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

  console.log('\n=== 5. 子杰错显抽检（非拾玉居早场店铺） ===')
  const ziJieWrong = rows.filter((row) => {
    if ((row.anchorName?.trim() || '') !== '子杰') return false
    const shop = (row.liveAccountName ?? '').trim()
    if (!shop || shop.includes('拾玉居')) return false
    const orderNo = row.orderNo || row.packageId || ''
    const expected = expectedMap.get(orderNo) ?? expectedMap.get(orderNo.replace(/^P/, ''))
    return expected != null && expected !== '子杰'
  })
  console.log(`可疑子杰错显: ${ziJieWrong.length}`)
  for (const row of ziJieWrong.slice(0, 10)) {
    const orderNo = row.orderNo || row.packageId || ''
    const expected = expectedMap.get(orderNo) ?? expectedMap.get(orderNo.replace(/^P/, ''))
    console.log(`  ${orderNo} shop=${row.liveAccountName} drawer=子杰 expected=${expected}`)
  }

  console.log('\n=== 验收 ===')
  if (mismatches.length > 0 || focusFails.length > 0) {
    if (mismatches.length > 0) {
      console.log(`✗ FAIL: ${mismatches.length} 行 anchorName 与 remap 不一致`)
    }
    if (focusFails.length > 0) {
      console.log(`✗ FAIL: 重点订单 ${focusFails.length} 笔未通过`)
      for (const f of focusFails) console.log(`  - ${f}`)
    }
    process.exit(1)
  }
  console.log('✓ PASS: metric drawer 主播归属与 remapViewsWithScheduleOverlay 一致')
}

main()
  .catch((err) => {
    console.error('FAIL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
