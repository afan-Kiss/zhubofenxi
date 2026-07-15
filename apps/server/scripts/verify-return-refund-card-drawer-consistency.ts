/**
 * 退货退款卡片 / Drawer 过滤一致性（静态）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

function main() {
  const root = path.resolve(__dirname, '../../..')
  const detail = fs.readFileSync(
    path.join(root, 'apps/server/src/services/board-metric-detail.service.ts'),
    'utf8',
  )
  assert.match(detail, /returnRefundCount/)
  assert.match(detail, /isReturnRefundOrder/)
  assert.match(detail, /valueKey: 'returnRefundCount'/)
  console.log('✓ board-metric-detail 支持 returnRefundCount 过滤')

  const drawer = fs.readFileSync(
    path.join(root, 'apps/web/src/components/board/BoardMetricDrawer.tsx'),
    'utf8',
  )
  assert.match(drawer, /returnRefundCount/)
  console.log('✓ BoardMetricDrawer 含 returnRefundCount')

  const panel = fs.readFileSync(
    path.join(root, 'apps/web/src/components/board/AnchorLeaderboardPanel.tsx'),
    'utf8',
  )
  const tab = fs.readFileSync(
    path.join(root, 'apps/web/src/pages/board/AnchorPerformanceTab.tsx'),
    'utf8',
  )
  assert.match(panel, /onReturnRefundCountClick/)
  assert.match(panel, /退货退款单数/)
  assert.match(panel, /退款单数/)
  assert.match(tab, /label: 'GMV'/)
  assert.match(tab, /label: '已签收单数'/)
  assert.match(tab, /label: '退款单数'/)
  assert.match(tab, /更多指标/)
  assert.match(tab, /部分退款单尚未同步售后明细|售后明细尚未完整同步/)
  console.log('✓ 主播榜支持退货退款下钻与退款单数列')

  assert.match(tab, /returnRefundCount/)
  assert.match(tab, /退款单数/)
  console.log('✓ 主播业绩页含退款单数与类型不完整提示')

  const buildViews = fs.readFileSync(
    path.join(root, 'apps/server/src/services/business-analysis.service.ts'),
    'utf8',
  )
  assert.match(buildViews, /resolveReturnRefundClassification/)
  assert.doesNotMatch(buildViews, /isReturnRefundOrder:\s*Boolean\(afterSaleAgg\?\.hasReturnRefund\)/)
  console.log('✓ buildViews 使用统一分类，不再仅依赖 afterSaleAgg.hasReturnRefund')

  console.log('\nverify:return-refund-card-drawer-consistency PASS')
}

main()
