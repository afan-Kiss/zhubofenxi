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
  DRAWER_VERIFY_METRICS,
  buildRemappedAnchorMap,
  buildRemappedViews,
  compareDrawerRowsToRemap,
  fetchMetricDetailBundle,
  findRemappedViewByOrderNo,
  isOrderEligibleForEffectiveGmvMustInclude,
  orderInDrawerRows,
  orderKeys,
  resolveEffectiveGmvMustIncludeForAnchor,
  sumDrawerRowMetricValue,
  verifyAnchorMetricDrawer,
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

const ORDER_P798524 = 'P798524075193091331'
const ORDER_P798440 = 'P798440490066093751'

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
  const remappedViews = await buildRemappedViews({ startDate: START_DATE, endDate: END_DATE })
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
    const view = findRemappedViewByOrderNo(remappedViews, orderNo)
    const eligibility = isOrderEligibleForEffectiveGmvMustInclude({
      orderNo,
      remappedViews,
      storeEffectiveGmvRows: effectiveBundle.rows,
    })
    const wrongZiJie = rowAnchor === '子杰' && expected !== '子杰'
    const mismatch = row != null && rowAnchor !== expected && rowAnchor !== '（未出现在 drawer）'
    const invalidButAbsent =
      !eligibility.eligible && row == null && expected !== '—' ? '（非有效成交，drawer 正确不展示）' : ''
    const status = wrongZiJie || mismatch ? '✗' : '✓'
    console.log(
      `${status} ${orderNo}: drawer=${rowAnchor} expected=${expected} valid=${eligibility.valid} ${invalidButAbsent} shop=${row?.liveAccountName ?? view?.liveAccountName ?? '—'}`,
    )
    if (wrongZiJie) focusFails.push(`${orderNo}: 不应显示子杰（期望 ${expected}）`)
    else if (mismatch) focusFails.push(`${orderNo}: drawer=${rowAnchor} expected=${expected}`)
  }

  console.log('\n=== 3b. P798524075193091331 / P798440490066093751 有效成交池 ===')
  for (const orderNo of [ORDER_P798524, ORDER_P798440]) {
    const expected =
      expectedMap.get(orderNo) ?? expectedMap.get(orderNo.replace(/^P/, '')) ?? '—'
    if (expected === '—') {
      console.log(`\n${orderNo}: 本地验收范围无 remap 数据，跳过显式断言（请在生产环境复验）`)
      continue
    }
    const eligibility = isOrderEligibleForEffectiveGmvMustInclude({
      orderNo,
      remappedViews,
      storeEffectiveGmvRows: effectiveBundle.rows,
    })
    const inStore = orderInDrawerRows(effectiveBundle.rows, orderNo)
    const xiaoyiDrawer = await fetchMetricDetailBundle({
      metric: 'effectiveGmv',
      startDate: START_DATE,
      endDate: END_DATE,
      anchorName: '小艺',
    })
    const inXiaoyi = orderInDrawerRows(xiaoyiDrawer.rows, orderNo)
    const zijieDrawer = await fetchMetricDetailBundle({
      metric: 'effectiveGmv',
      startDate: START_DATE,
      endDate: END_DATE,
      anchorName: '子杰',
    })
    const inZijie = orderInDrawerRows(zijieDrawer.rows, orderNo)

    console.log(`\n${orderNo}:`)
    console.log(`  remap 归属: ${expected}`)
    console.log(`  isValidRevenueOrder: ${eligibility.valid}`)
    console.log(`  全店 effectiveGmv drawer: ${inStore ? '包含' : '不包含'}`)
    console.log(`  小艺 effectiveGmv drawer: ${inXiaoyi ? '包含' : '不包含'}`)

    if (expected !== '小艺') {
      focusFails.push(`${orderNo}: remap 期望小艺，实际 ${expected}`)
      continue
    }
    if (orderNo === ORDER_P798524) {
      if (inStore) focusFails.push(`${orderNo}: 非有效成交不应出现在全店 effectiveGmv drawer`)
      if (inXiaoyi) focusFails.push(`${orderNo}: 非有效成交不应出现在小艺 effectiveGmv drawer`)
      if (!eligibility.eligible) {
        console.log(`  ✓ ${eligibility.reason}`)
      }
    } else if (eligibility.eligible) {
      if (!inXiaoyi) {
        focusFails.push(`${orderNo}: valid=true 或全店 drawer 有，但小艺 drawer 缺失`)
      } else {
        console.log(`  ✓ valid 订单，小艺 drawer 应包含且已包含`)
      }
    } else {
      console.log(`  ✓ ${eligibility.reason}`)
      if (inXiaoyi) focusFails.push(`${orderNo}: 非有效成交不应出现在小艺 effectiveGmv drawer`)
    }
    if (inZijie) focusFails.push(`${orderNo}: 不应出现在子杰 effectiveGmv drawer`)
  }

  console.log('\n=== 4. 主播维度各 metric drawer（同池） ===')
  const anchorFails: string[] = []
  const effectiveGmvEligibility = (orderNo: string) =>
    isOrderEligibleForEffectiveGmvMustInclude({
      orderNo,
      remappedViews,
      storeEffectiveGmvRows: effectiveBundle.rows,
    })
  for (const anchorName of ANCHOR_DRAWER_NAMES) {
    console.log(`\n--- ${anchorName} ---`)
    for (const metric of DRAWER_VERIFY_METRICS) {
      let mustInclude: string[] | undefined
      if (metric === 'effectiveGmv') {
        const resolved = resolveEffectiveGmvMustIncludeForAnchor({
          anchorName,
          remappedViews,
          storeEffectiveGmvRows: effectiveBundle.rows,
        })
        mustInclude = resolved.mustInclude
        for (const skip of resolved.skipped) {
          console.log(`  ○ effectiveGmv mustInclude 跳过 ${skip.orderNo}: ${skip.reason}`)
        }
      }
      const fails = await verifyAnchorMetricDrawer({
        startDate: START_DATE,
        endDate: END_DATE,
        metric,
        anchorName,
        mustInclude,
        mustExclude:
          metric === 'effectiveGmv'
            ? ANCHOR_MUST_EXCLUDE[anchorName as keyof typeof ANCHOR_MUST_EXCLUDE]
            : undefined,
        remappedAnchorMap: expectedMap,
        effectiveGmvEligibility: metric === 'effectiveGmv' ? effectiveGmvEligibility : undefined,
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

  console.log('\n=== 5. 主播签收率详情 Tab 去重 ===')
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
