/**
 * 今日经营指标自测：导入真实表格最新订单表后核对 GMV / 订单数
 * 用法：npx tsx apps/server/scripts/today-metrics-check.ts
 */
import { importLatestOrderQueryExcelFromRealTableDir } from '../src/services/xhs-excel-order-import.service'
import { loadBoardViewsForRange } from '../src/services/board-metrics.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { centToYuan } from '../src/utils/money'

const EXPECTED_PACKAGES = [
  'P795499892853285161',
  'P795499758124285701',
  'P795498675546275371',
  'P795495788583458651',
  'P795494448698499251',
  'P795494391081499051',
  'P795491110326121261',
  'P795490183646098221',
  'P795488136122205841',
  'P795487315710005941',
]

async function main() {
  try {
    const imp = await importLatestOrderQueryExcelFromRealTableDir()
    console.log('import', imp.filePath, 'rows', imp.rowCount, 'saved', imp.savedCount)
  } catch (e) {
    console.warn('skip import:', e instanceof Error ? e.message : e)
  }

  const { views } = await loadBoardViewsForRange('today')
  const m = calculateBusinessMetrics(views)
  const ids = new Set(views.map((v) => v.packageId || v.orderId))

  console.log('\n--- today metrics ---')
  console.log('orderCount (non-cancel non-unpaid):', m.orderCount)
  console.log('totalGmv (yuan):', m.totalGmv)
  const gmvCentSum = views.filter((v) => v.includedInGmv).reduce((s, v) => s + v.paymentBaseCent, 0)
  console.log('totalGmv from cents:', centToYuan(gmvCentSum))
  console.log('views in range:', views.length)

  for (const pkg of EXPECTED_PACKAGES) {
    const v = views.find((x) => (x.packageId || x.orderId) === pkg)
    if (!v) {
      console.log(pkg, 'MISSING from today views')
      continue
    }
    console.log(
      pkg,
      'cancelled?',
      v.orderStatusText?.includes('取消'),
      'includedInGmv',
      v.includedInGmv,
      'paymentBase',
      v.paymentBaseCent,
      'source',
      v.paymentBaseSource,
      'status',
      v.orderStatusText,
    )
  }

  const missing = EXPECTED_PACKAGES.filter((p) => !ids.has(p))
  if (missing.length) console.log('\nMISSING packages:', missing.join(', '))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
