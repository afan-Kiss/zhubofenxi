/**
 * 月度结账核对（只读）
 * 用法:
 *   npm run monthly:close-check -- --month=2026-06
 *   npm run monthly:close-check -- --auto-prev-month
 *   npm run monthly:close-check -- --month=2026-06 --with-audit
 *
 * 说明：仅跑本脚本只覆盖 buildMonthlyCloseReconciliation，不能代表完整数据健康通过。
 * 完整验收请用 npm run monthly:close-full-check 或 npm run data:audit:month -- --fullScan
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

function parseArgs(): {
  month?: string
  autoPrevMonth?: boolean
  skipCrossCheck?: boolean
  withAudit?: boolean
} {
  const out: {
    month?: string
    autoPrevMonth?: boolean
    skipCrossCheck?: boolean
    withAudit?: boolean
  } = {}
  for (const arg of process.argv.slice(2)) {
    if (arg === '--auto-prev-month') out.autoPrevMonth = true
    else if (arg === '--skip-cross-check') out.skipCrossCheck = true
    else if (arg === '--with-audit') out.withAudit = true
    else if (arg.startsWith('--month=')) out.month = arg.slice('--month='.length)
  }
  if (!out.month && !out.autoPrevMonth) out.autoPrevMonth = true
  return out
}

async function main(): Promise<void> {
  const args = parseArgs()
  const report = await buildMonthlyCloseReconciliation({
    month: args.month,
    autoPrevMonth: args.autoPrevMonth,
    skipMonthlyReportCrossCheck: args.skipCrossCheck,
  })

  console.log('\n========== 月度结账核对报告 ==========\n')
  console.log(JSON.stringify(report, null, 2))
  console.log('\n========== 大白话结论 ==========\n')
  console.log(`月份：${report.scope.month}（${report.scope.startDate} ~ ${report.scope.endDate}）`)
  console.log(`数据完整性评分：${report.dataQuality.score}/100（${report.dataQuality.level}）`)
  console.log(`能否判断盈亏：${report.sectionF.conclusionTier}`)
  console.log(report.sectionF.conclusionMessage)
  console.log(`有效成交金额：¥${Number(report.sectionB.validAmountYuan).toLocaleString('zh-CN')}`)
  console.log(`退款相关金额（约）：¥${Number(report.sectionF.refundAmountYuan).toLocaleString('zh-CN')}`)
  if (report.sectionF.settlementAmountYuan != null) {
    console.log(`结算金额（约）：¥${Number(report.sectionF.settlementAmountYuan).toLocaleString('zh-CN')}`)
  } else {
    console.log('结算金额：暂无足够数据')
  }
  console.log('成本/支出：系统暂无，不能算净利润')
  if (report.dataQuality.blockers.length) {
    console.log('\n阻塞项：')
    for (const b of report.dataQuality.blockers) console.log(` - ${b}`)
  }
  if (report.dataQuality.warnings.length) {
    console.log('\n提醒：')
    for (const w of report.dataQuality.warnings) console.log(` - ${w}`)
  }

  if (args.withAudit) {
    const scope = resolveMonthlyCloseMonth({
      month: args.month,
      autoPrevMonth: args.autoPrevMonth,
    })
    const audit = await runDataAccuracyAudit({
      startDate: scope.startDate,
      endDate: scope.endDate,
      scope: 'monthly',
      fullScan: true,
    })
    const blockingIssues = audit.blockingIssues ?? buildBlockingIssueSummary(audit.checks)
    console.log('\n========== 数据健康 fullScan（--with-audit）==========\n')
    console.log(`状态：${audit.status}；score=${audit.score}`)
    console.log(`金额差异合计：${audit.moneyDiffCentTotal} 分；订单差异：${audit.orderDiffTotal}`)
    console.log('\nblockingIssues：')
    if (blockingIssues.length === 0) {
      console.log('（无）')
    } else {
      for (const b of blockingIssues) console.log(` - ${b}`)
    }
    console.log('\nchecks：')
    console.log(JSON.stringify(audit.checks, null, 2))
  }

  console.log('\n[monthly:close-check] 完成（只读，未写入任何业务表）')
  if (!args.withAudit) {
    console.log(
      '提示：本脚本仅跑 reconciliation，不能代表完整数据健康通过；请加 --with-audit 或使用 monthly:close-full-check',
    )
  }
}

main()
  .catch((err) => {
    console.error('[monthly:close-check] ERROR', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
