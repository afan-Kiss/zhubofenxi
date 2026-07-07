/**
 * 系统逻辑 / 口径 / 运行稳定性小巡检
 *
 * npm run verify:system-logic-sweep
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  calculateBusinessMetrics,
  viewInvolvesRefundAfterSale,
} from '../src/services/business-metrics.service'
import {
  resolveViewRefundAmountCent,
  viewCountsAsRefundOrder,
} from '../src/services/order-refund-metrics.service'
import { isActualAfterSaleOrder } from '../src/services/operations-after-sale-order.util'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'
import {
  explainValidRevenueOrder,
  isValidRevenueOrder,
  resolveValidRevenueRefundAmountCent,
} from '../src/services/valid-revenue-order.service'
import { computeOperationsRefundMetricsFromViews } from '../src/services/operations-after-sale-order.util'
import { buildOrderMetricSets } from '../src/services/order-metric-sets.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

const ROOT = path.resolve(__dirname, '../..')
const REPO_ROOT = path.resolve(__dirname, '../../..')
const issues: string[] = []
const warnings: string[] = []

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

function warn(msg: string): void {
  warnings.push(msg)
  console.log(`  ⚠ ${msg}`)
}

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf-8')
}

function main(): void {
  console.log('verify-system-logic-sweep')

  const deploySh = fs.readFileSync(path.resolve(REPO_ROOT, 'deploy/aliyun/deploy.sh'), 'utf-8')
  if (
    deploySh.includes('if [[ "${RUN_SCHEDULE_REPAIR_20260701:-0}" == "1" ]]; then') &&
    deploySh.includes('npx tsx apps/server/scripts/repair-schedule-templates-20260701.ts')
  ) {
    ok('deploy.sh repair-schedule 仅在 RUN_SCHEDULE_REPAIR_20260701=1 时执行')
  } else {
    fail('deploy.sh 未正确包裹 repair-schedule 开关')
  }
  if (deploySh.includes('skip schedule repair templates from 20260701')) {
    ok('deploy.sh 默认 skip 排班修复日志')
  } else {
    fail('deploy.sh 缺少 skip 排班修复日志')
  }

  const goodReviewsPage = read('web/src/pages/good-reviews/GoodReviewsPage.tsx')
  if (
    goodReviewsPage.includes('handleSyncAll') &&
    goodReviewsPage.includes('for (let i = 0; i < total; i++)') &&
    goodReviewsPage.match(/for \(let i = 0; i < total; i\+\+\)[\s\S]*?try \{[\s\S]*?catch \(err\)/)
  ) {
    ok('GoodReviewsPage handleSyncAll 单店 try/catch')
  } else {
    fail('GoodReviewsPage handleSyncAll 未做单店 try/catch')
  }
  if (goodReviewsPage.includes('mergeGoodReviewSyncResults(shopResults')) {
    ok('GoodReviewsPage 汇总 mergeGoodReviewSyncResults')
  } else {
    fail('GoodReviewsPage 未汇总 mergeGoodReviewSyncResults')
  }

  const anchorDrawer = read('web/src/components/board/AnchorOrderDrawer.tsx')
  if (anchorDrawer.includes("amountMode={orderTab === 'signed' ? 'signed' : 'default'}")) {
    ok('AnchorOrderDrawer signed Tab 传 amountMode=signed')
  } else {
    fail('AnchorOrderDrawer 未传 amountMode=signed')
  }

  const metricDetail = read('server/src/services/board-metric-detail.service.ts')
  if (!metricDetail.includes("title: '有效成交额'")) {
    ok('board-metric-detail 用户可见 title 不再是「有效成交额」')
  } else {
    fail('board-metric-detail 仍含用户可见「有效成交额」')
  }
  if (metricDetail.includes('remapViewsWithScheduleOverlay')) {
    ok('board-metric-detail 仍走 remapViewsWithScheduleOverlay')
  } else {
    fail('board-metric-detail 缺少 remapViewsWithScheduleOverlay')
  }

  const qianfan = read('web/src/lib/qianfan-order-detail.ts')
  if (qianfan.includes("window.open('about:blank', '_blank')") && qianfan.includes('newWin.location.href')) {
    ok('qianfan-order-detail 先开窗口再跳转')
  } else {
    fail('qianfan-order-detail 未先开窗口再跳转')
  }

  const boardLocal = read('server/src/services/board-local-query.service.ts')
  if (
    boardLocal.includes('logAnchorLeaderboardReconcile') &&
    !boardLocal.includes('(Number(unassigned.totalGmv ?? unassigned.gmv ?? 0) / 100).toFixed(2)')
  ) {
    ok('board-local-query 日志未对 unassigned totalGmv/gmv 除以 100')
  } else {
    fail('board-local-query 日志仍对 totalGmv/gmv 除以 100')
  }

  const overview = read('web/src/pages/board/OverviewTab.tsx')
  if (
    overview.includes("drawerKey: 'actualSignedAmount'") &&
    overview.includes("valueKey: 'actualSignedAmount'")
  ) {
    ok('经营总览首屏仍使用 actualSignedAmount')
  } else {
    fail('经营总览首屏未使用 actualSignedAmount')
  }

  const metricDrawer = read('web/src/components/board/BoardMetricDrawer.tsx')
  if (metricDrawer.includes("metric === 'actualSignedAmount' ? 'signed' : 'default'")) {
    ok('BoardMetricDrawer actualSignedAmount 仍 amountMode=signed')
  } else {
    fail('BoardMetricDrawer actualSignedAmount 未 amountMode=signed')
  }

  const businessMetrics = read('server/src/services/business-metrics.service.ts')
  const viewInvolvesBlock = businessMetrics.slice(
    businessMetrics.indexOf('function viewInvolvesRefundAfterSale'),
    businessMetrics.indexOf('function viewInvolvesRefundAfterSale') + 220,
  )
  if (viewInvolvesBlock.includes('isFreightRefundOnly')) {
    ok('viewInvolvesRefundAfterSale 排除 isFreightRefundOnly')
  } else {
    fail('viewInvolvesRefundAfterSale 未排除 isFreightRefundOnly')
  }

  console.log('\n=== 纯运费补偿(18元)运行时断言 ===')
  const freightView = {
    packageId: 'PKG-FREIGHT-SYSTEM-VERIFY',
    includedInGmv: true,
    paymentBaseCent: 50000,
    isFreightRefundOnly: true,
    freightRefundAmountCent: 1800,
    productRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    returnAmountCent: 1800,
    afterSaleStatusText: '退款成功',
    afterSaleDisplayType: '运费补偿',
    orderStatusText: '已完成',
    statusSigned: true,
    actualSignAmountCent: 50000,
  } as AnalyzedOrderView
  const realView = {
    packageId: 'PKG-REAL-AFTERSALE-SYSTEM-VERIFY',
    includedInGmv: true,
    isFreightRefundOnly: false,
    productRefundAmountCent: 1800,
    realAfterSaleAmountCent: 1800,
    afterSaleStatusText: '退款成功',
  } as AnalyzedOrderView

  if (!viewInvolvesRefundAfterSale(freightView)) ok('纯运费 viewInvolvesRefundAfterSale=false')
  else fail('纯运费 viewInvolvesRefundAfterSale 误判')
  if (!viewCountsAsRefundOrder(freightView)) ok('纯运费 viewCountsAsRefundOrder=false')
  else fail('纯运费 viewCountsAsRefundOrder 误判')
  if (resolveViewRefundAmountCent(freightView) === 0) ok('纯运费 resolveViewRefundAmountCent=0')
  else fail('纯运费 resolveViewRefundAmountCent 非 0')
  if (!isActualAfterSaleOrder(freightView)) ok('纯运费 isActualAfterSaleOrder=false')
  else fail('纯运费 isActualAfterSaleOrder 误判')
  if (isEffectiveSignedView(freightView)) ok('纯运费 isEffectiveSignedView=true')
  else fail('纯运费 isEffectiveSignedView 误判')
  const freightMetrics = calculateBusinessMetrics([freightView])
  if (
    freightMetrics.refundAmount === 0 &&
    freightMetrics.refundOrderCount === 0 &&
    freightMetrics.afterSaleRelatedOrderCount === 0 &&
    freightMetrics.freightRefundAmount === 18 &&
    freightMetrics.actualSignedAmount === 500
  ) {
    ok('纯运费 calculateBusinessMetrics 口径正确')
  } else {
    fail('纯运费 calculateBusinessMetrics 口径异常')
  }
  if (viewInvolvesRefundAfterSale(realView) && viewCountsAsRefundOrder(realView)) {
    ok('真实售后 viewInvolvesRefundAfterSale/viewCountsAsRefundOrder=true')
  } else {
    fail('真实售后未识别')
  }
  if (resolveViewRefundAmountCent(realView) === 1800) ok('真实售后 resolveViewRefundAmountCent=1800')
  else fail(`真实售后 resolveViewRefundAmountCent=${resolveViewRefundAmountCent(realView)}`)

  const freightValidView = {
    ...freightView,
    effectiveGmvCent: 50000,
  } as AnalyzedOrderView
  if (resolveValidRevenueRefundAmountCent(freightValidView) === 0) {
    ok('纯运费 resolveValidRevenueRefundAmountCent=0')
  } else {
    fail('纯运费 resolveValidRevenueRefundAmountCent 非 0')
  }
  if (isValidRevenueOrder(freightValidView)) ok('纯运费 isValidRevenueOrder=true')
  else fail(`纯运费 isValidRevenueOrder=false: ${explainValidRevenueOrder(freightValidView).reason}`)
  const realValidView = {
    ...realView,
    orderStatusText: '已完成',
    effectiveGmvCent: 50000,
    returnAmountCent: 1800,
  } as AnalyzedOrderView
  if (!isValidRevenueOrder(realValidView)) ok('真实商品退款 isValidRevenueOrder=false')
  else fail('真实商品退款 isValidRevenueOrder 误判')

  console.log('\n=== 运营退款单数去重 ===')
  const orderNo = 'P-OPS-REFUND-SYSTEM-VERIFY'
  const opsViews = [
    { packageId: orderNo, includedInGmv: true, productRefundAmountCent: 0 } as AnalyzedOrderView,
    {
      packageId: orderNo,
      includedInGmv: true,
      productRefundAmountCent: 1800,
      afterSaleStatusText: '退款成功',
    } as AnalyzedOrderView,
  ]
  const ops = computeOperationsRefundMetricsFromViews(opsViews)
  const board = buildOrderMetricSets(opsViews)
  if (ops.refundOrderCount === 1 && board.refundOrderCount === 1) {
    ok('运营/看板退款单数均为 1')
  } else {
    fail(`运营=${ops.refundOrderCount} 看板=${board.refundOrderCount}`)
  }

  console.log('\n=== 有效成交 / 运费抽屉 / 运营去重（静态） ===')
  const validRevenueSvc = read('server/src/services/valid-revenue-order.service.ts')
  const businessAnalysis = read('server/src/services/business-analysis.service.ts')
  const metricDetailSvc = read('server/src/services/board-metric-detail.service.ts')
  const calcRefundRate = read('server/src/services/calc-refund-rate.service.ts')
  if (validRevenueSvc.includes('if (view.isFreightRefundOnly) return 0')) {
    ok('valid-revenue 排除纯运费退款金额')
  } else {
    fail('valid-revenue 未排除纯运费')
  }
  if (businessAnalysis.includes('classification.isFreightRefundOnly')) {
    ok('business-analysis 纯运费不污染 boardRefundCent')
  } else {
    fail('business-analysis 未隔离纯运费 boardRefundCent')
  }
  if (metricDetailSvc.includes('dedupeFreightRefundViewsByOrderNoMaxFreight')) {
    ok('board-metric-detail 运费抽屉去重')
  } else {
    fail('board-metric-detail 缺少运费去重')
  }
  if (calcRefundRate.includes('dedupeFreightRefundViewsByOrderNoMaxFreight')) {
    ok('calc-refund-rate 导出 dedupeFreightRefundViewsByOrderNoMaxFreight')
  } else {
    fail('calc-refund-rate 缺少 dedupeFreightRefundViewsByOrderNoMaxFreight')
  }

  console.log('\n=== Drawer 双请求（已知问题，warning） ===')
  const drawerEffectCount = (metricDrawer.match(/useEffect\s*\(/g) ?? []).length
  if (
    drawerEffectCount >= 2 &&
    metricDrawer.includes('setPage(1)') &&
    metricDrawer.includes('/api/board/metric-detail')
  ) {
    warn(
      'BoardMetricDrawer 当前存在 reset effect + fetch effect，打开 Drawer 可能发起 2 次 metric-detail 请求，后续单独修',
    )
  } else {
    ok('BoardMetricDrawer 未发现 reset+fetch 双 effect 模式')
  }

  console.log('\n=== 请求职责边界（静态） ===')
  const buyerRanking = read('server/src/services/buyer-ranking-cache.service.ts')
  const scheduler = read('server/src/services/scheduler.service.ts')
  const dailySync = read('server/src/services/daily-sync-strategy.service.ts')
  const rawAnalysis = read('server/src/services/xhs-api-sync/xhs-analysis-from-raw.service.ts')

  const forbiddenInGet = [
    'requestXhsJsonWithSyncAudit',
    'enqueueXhsRequest',
    'syncOrderList',
    'fetchAfterSalesWorkbenchByOrderNo',
    'processWorkbenchQueueBatch',
    'runOfficialQualityBadCaseSyncStep',
  ]
  for (const p of forbiddenInGet) {
    if (!boardLocal.includes(p)) ok(`board-local-query 无 ${p}`)
    else fail(`board-local-query 含 ${p}`)
  }

  for (const p of [
    'processWorkbenchQueueBatch',
    'warmWorkbenchCacheForOrders',
    'fetchAfterSalesWorkbenchByOrderNo',
    'requestXhsJsonWithSyncAudit',
  ]) {
    if (!buyerRanking.includes(p)) ok(`buyer-ranking-cache 无 ${p}`)
    else fail(`buyer-ranking-cache 含 ${p}`)
  }

  if (
    !rawAnalysis.includes('syncAfterSalesTimeSearchForRange') &&
    !rawAnalysis.includes('fetchAfterSalesWorkbenchByOrderNo')
  ) {
    ok('xhs-analysis-from-raw 读路径无 sync/fetch 售后平台 API')
  } else {
    fail('xhs-analysis-from-raw 读路径仍含售后平台 API')
  }

  const buyerCron = scheduler.slice(
    scheduler.indexOf('function scheduleBuyerRankingCache'),
    scheduler.indexOf('function scheduleBuyerRankingCache') + 900,
  )
  if (!buyerCron.includes('runRollingDataHealthClose')) {
    ok('买家排行 cron 未挂 runRollingDataHealthClose')
  } else {
    fail('买家排行 cron 仍挂 runRollingDataHealthClose')
  }
  if (scheduler.includes('scheduleRollingDataHealthClose')) {
    ok('scheduler 含独立 scheduleRollingDataHealthClose')
  } else {
    fail('scheduler 缺少 scheduleRollingDataHealthClose')
  }

  if (dailySync.includes("DEFAULT_BUSINESS_SYNC_MODE: BusinessSyncMode = 'business_core'")) {
    ok('daily-sync 默认 business_core')
  } else {
    fail('daily-sync 默认模式非 business_core')
  }
  if (dailySync.includes('shouldSyncQuality') && !dailySync.includes('processWorkbenchQueueBatch')) {
    ok('daily-sync 品退受 mode 控制且无工作台 queue')
  } else {
    fail('daily-sync 职责边界未清晰')
  }

  console.log('\n=== 结果 ===')
  if (warnings.length > 0) {
    console.log(`WARN (${warnings.length})`)
    for (const w of warnings) console.log(` - ${w}`)
  }
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(` - ${i}`)
    process.exit(1)
  }
  console.log('PASS')
}

main()
