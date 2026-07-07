/**
 * 品退指标下钻与主播卡片/品退抽屉一致性验收
 *
 * npm run verify:quality-metric-detail-consistency
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import { buildAnchorQualityRefundDrill } from '../src/services/board-drill.service'

config({ path: path.resolve(__dirname, '../.env') })

const START = process.env.START_DATE?.trim() || '2026-06-01'
const END = process.env.END_DATE?.trim() || '2026-07-07'

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string): void {
  console.error(`  ✗ FAIL: ${msg}`)
}

async function main(): Promise<void> {
  console.log('verify-quality-metric-detail-consistency')
  console.log(`范围: ${START} ~ ${END}\n`)

  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: START,
    endDate: END,
  })

  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: START,
    endDate: END,
    role: 'super_admin',
    username: 'verify-script',
  })
  const leaderboard = (local.anchorLeaderboard ?? []) as Array<Record<string, unknown>>

  const anchors = [
    ...leaderboard.map((r) => String(r.anchorName ?? '')).filter(Boolean),
    '未归属',
  ]
  const uniqueAnchors = [...new Set(anchors)]

  let failures = 0
  for (const anchorName of uniqueAnchors) {
    const row = leaderboard.find((r) => String(r.anchorName) === anchorName)
    const cardCount = row ? Number(row.qualityReturnCount ?? 0) : 0

    const detail = await buildBoardMetricDetail({
      metric: 'qualityReturnCount',
      preset: 'custom',
      startDate: START,
      endDate: END,
      anchorName,
      page: 1,
      pageSize: 500,
      role: 'super_admin',
      username: 'verify-script',
    })

    const drawer = await buildAnchorQualityRefundDrill({
      preset: 'custom',
      startDate: START,
      endDate: END,
      anchorName,
      page: 1,
      pageSize: 500,
      role: 'super_admin',
      username: 'verify-script',
    })

    const detailTotal = detail.pagination?.total ?? detail.summary?.matchedOrders ?? 0
    const drawerTotal = drawer.pagination?.total ?? drawer.rows?.length ?? 0
    const detailMatched = Number(detail.summary?.matchedOrders ?? 0)

    if (cardCount !== detailTotal || cardCount !== drawerTotal || detailMatched !== cardCount) {
      fail(
        `${anchorName}: 卡片=${cardCount} detail.total=${detailTotal} detail.matched=${detailMatched} drawer=${drawerTotal}`,
      )
      failures++
    } else if (cardCount > 0 || anchorName === '未归属') {
      ok(`${anchorName}: 品退 ${cardCount} 单（卡片=detail=抽屉）`)
    }
  }

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
