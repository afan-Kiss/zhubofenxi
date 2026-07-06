/**
 * 系统逻辑 / 口径 / 运行稳定性小巡检
 *
 * npm run verify:system-logic-sweep
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const REPO_ROOT = path.resolve(__dirname, '../../..')
const issues: string[] = []

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
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

  console.log('\n=== 结果 ===')
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(` - ${i}`)
    process.exit(1)
  }
  console.log('PASS')
}

main()
