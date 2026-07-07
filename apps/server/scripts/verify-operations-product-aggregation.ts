/**
 * 周报/月报商品聚合验收：paidOrderCount、returnRate、高退货榜样本门槛
 *
 * npm run verify:operations-product-aggregation
 */
import path from 'node:path'
import { config } from 'dotenv'
import { eachDayInShanghaiRange } from '../src/utils/each-day-shanghai'
import { buildDailyOperationsReport } from '../src/services/daily-operations-report.service'
import {
  aggregateProductsFromSnapshots,
  buildWeeklyOperationsReport,
} from '../src/services/weekly-operations-report.service'
import {
  buildProductsForDateRange,
  computeProductReturnRateByOrder,
} from '../src/services/operations-product-analysis.service'
import { buildHighReturnProductRankings } from '../src/services/operations-product-ranking.service'

config({ path: path.resolve(__dirname, '../.env') })

const START = process.env.START_DATE?.trim() || '2026-06-01'
const END = process.env.END_DATE?.trim() || '2026-06-07'

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string): void {
  console.error(`  ✗ FAIL: ${msg}`)
}

async function main(): Promise<void> {
  console.log('verify-operations-product-aggregation')
  console.log(`范围: ${START} ~ ${END}\n`)

  const days = eachDayInShanghaiRange(START, END)
  const snapshots = []
  for (const dateKey of days) {
    snapshots.push(
      await buildDailyOperationsReport({
        preset: 'custom',
        startDate: dateKey,
        endDate: dateKey,
        role: 'super_admin',
        username: 'verify-script',
      }),
    )
  }

  const fromSnapshots = aggregateProductsFromSnapshots(snapshots)
  const fromRange = await buildProductsForDateRange({
    startDate: START,
    endDate: END,
    role: 'super_admin',
    username: 'verify-script',
  })

  let failures = 0

  for (const p of fromRange) {
    const paid = p.paidOrderCount ?? 0
    const ret = p.returnOrderCount ?? 0
    const expected = computeProductReturnRateByOrder(paid, ret)
    if (paid > 0 && expected != null) {
      const actual = p.returnRate ?? 0
      if (Math.abs(actual - expected) > 1e-9) {
        fail(`${p.productName}: returnRate ${actual} ≠ ${ret}/${paid}`)
        failures++
      }
    }
    if (paid <= 0 && p.returnRate != null && p.returnRate > 0) {
      fail(`${p.productName}: paidOrderCount=0 但 returnRate=${p.returnRate}`)
      failures++
    }
  }
  if (failures === 0) ok('全范围商品 returnRate = returnOrderCount / paidOrderCount')

  const snapshotMap = new Map(fromSnapshots.map((p) => [p.productKey, p]))
  let paidMismatch = 0
  for (const p of fromRange.filter((x) => (x.paidOrderCount ?? 0) >= 2)) {
    const snap = snapshotMap.get(p.productKey)
    if (!snap) continue
    if ((snap.paidOrderCount ?? 0) < (p.paidOrderCount ?? 0)) {
      paidMismatch++
      console.log(
        `  样例 ${p.productName}: 快照 paid=${snap.paidOrderCount} < 全范围 paid=${p.paidOrderCount}`,
      )
    }
  }
  if (paidMismatch > 0) {
    ok(`发现 ${paidMismatch} 个商品快照 paidOrderCount 低于全范围（周报/月报已改用全范围重建）`)
  } else {
    ok('无商品快照 paidOrderCount 明显低于全范围')
  }

  const { formal, sampleTooSmall } = buildHighReturnProductRankings(fromRange, 5)
  for (const item of formal) {
    if ((item.paidOrderCount ?? 0) < 3) {
      fail(`正式高退货榜 ${item.productName} paidOrderCount=${item.paidOrderCount} < 3`)
      failures++
    }
  }
  for (const item of sampleTooSmall) {
    if ((item.paidOrderCount ?? 0) >= 3) {
      fail(`样本不足榜 ${item.productName} paidOrderCount=${item.paidOrderCount} 应 < 3`)
      failures++
    }
  }
  ok(`高退货榜：正式 ${formal.length} / 样本不足 ${sampleTooSmall.length}`)

  const samples = fromRange.filter((p) => (p.paidOrderCount ?? 0) > 0).slice(0, 3)
  console.log('\n=== 商品样例对账 ===')
  for (const p of samples) {
    console.log(
      `${p.productName}: paid=${p.paidOrderCount} return=${p.returnOrderCount} rate=${p.returnRate != null ? (p.returnRate * 100).toFixed(1) + '%' : '—'} amount=¥${p.soldAmountYuan}`,
    )
  }

  const weekReport = await buildWeeklyOperationsReport({
    weekStart: START,
    weekEnd: END,
    role: 'super_admin',
    username: 'verify-script',
  })
  ok(
    `周报商品榜：热卖 ${weekReport.hotProducts.length} / 高退货 ${weekReport.highReturnProducts.length}`,
  )

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
