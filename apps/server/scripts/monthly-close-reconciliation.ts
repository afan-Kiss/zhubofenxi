/**
 * 月度结账核对（只读）
 * 用法:
 *   npm run monthly:close-check -- --month=2026-06
 *   npm run monthly:close-check -- --auto-prev-month
 */
import fs from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

const serverEnv = path.resolve(process.cwd(), 'apps/server/.env')
if (fs.existsSync(serverEnv)) loadEnv({ path: serverEnv })
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:../data/app.db'

import { prisma } from '../src/lib/prisma'
import { buildMonthlyCloseReconciliation } from '../src/services/monthly-close-reconciliation.service'

function parseArgs(): { month?: string; autoPrevMonth?: boolean; skipCrossCheck?: boolean } {
  const out: { month?: string; autoPrevMonth?: boolean; skipCrossCheck?: boolean } = {}
  for (const arg of process.argv.slice(2)) {
    if (arg === '--auto-prev-month') out.autoPrevMonth = true
    else if (arg === '--skip-cross-check') out.skipCrossCheck = true
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
  console.log('\n[monthly:close-check] 完成（只读，未写入任何业务表）')
}

main()
  .catch((err) => {
    console.error('[monthly:close-check] ERROR', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
