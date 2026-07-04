/**
 * 月度结账完整核对：reconciliation + 数据健康 fullScan audit
 * 用法:
 *   npm run monthly:close-full-check -- --month=2026-06
 *   npm run monthly:close-full-check -- --auto-prev-month
 */
import fs from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

const serverEnv = path.resolve(process.cwd(), 'apps/server/.env')
if (fs.existsSync(serverEnv)) loadEnv({ path: serverEnv })
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:../data/app.db'

import { prisma } from '../src/lib/prisma'
import { buildMonthlyCloseReconciliation } from '../src/services/monthly-close-reconciliation.service'
import { runDataAccuracyAudit } from '../src/services/data-accuracy-audit.service'
import { buildBlockingIssueSummary } from '../src/services/data-accuracy-audit-diff.util'
import { resolveMonthlyCloseMonth } from '../src/utils/monthly-close-month.util'

function parseArgs(): { month?: string; autoPrevMonth?: boolean } {
  const out: { month?: string; autoPrevMonth?: boolean } = {}
  for (const arg of process.argv.slice(2)) {
    if (arg === '--auto-prev-month') out.autoPrevMonth = true
    else if (arg.startsWith('--month=')) out.month = arg.slice('--month='.length)
  }
  if (!out.month && !out.autoPrevMonth) out.autoPrevMonth = true
  return out
}

async function main(): Promise<void> {
  const args = parseArgs()
  const scope = resolveMonthlyCloseMonth({
    month: args.month,
    autoPrevMonth: args.autoPrevMonth,
  })

  const [reconciliation, audit] = await Promise.all([
    buildMonthlyCloseReconciliation({
      month: args.month,
      autoPrevMonth: args.autoPrevMonth,
    }),
    runDataAccuracyAudit({
      startDate: scope.startDate,
      endDate: scope.endDate,
      scope: 'monthly',
      fullScan: true,
    }),
  ])

  const blockingIssues = audit.blockingIssues ?? buildBlockingIssueSummary(audit.checks)

  console.log('\n========== 月度结账完整核对（reconciliation + 数据健康 fullScan）==========\n')
  console.log(`月份：${scope.month}（${scope.startDate} ~ ${scope.endDate}）`)
  console.log(`数据健康状态：${audit.status}（score=${audit.score}）`)
  console.log(`金额差异合计：${audit.moneyDiffCentTotal} 分；订单差异合计：${audit.orderDiffTotal}`)
  console.log('\n--- reconciliation sectionB（cent 口径）---')
  console.log(
    JSON.stringify(
      {
        validAmountCent: reconciliation.sectionB.validAmountCent,
        validAmountYuan: reconciliation.sectionB.validAmountYuan,
        validSoldOrderCount: reconciliation.sectionB.validSoldOrderCount,
      },
      null,
      2,
    ),
  )
  console.log('\n--- 数据健康 blockingIssues ---')
  if (blockingIssues.length === 0) {
    console.log('（无阻塞项）')
  } else {
    for (const b of blockingIssues) console.log(` - ${b}`)
  }
  console.log('\n--- 数据健康 checks ---')
  console.log(JSON.stringify(audit.checks, null, 2))
  console.log('\n[monthly:close-full-check] 完成')
  console.log(
    '说明：仅跑 monthly:close-check 只覆盖 reconciliation，不能代表完整数据健康通过；完整验收请用 monthly:close-full-check 或 data:audit:month -- --fullScan',
  )
}

main()
  .catch((err) => {
    console.error('[monthly:close-full-check] ERROR', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
