/**
 * 支付时间预筛漏单诊断（只读，直接扫描 raw 订单，绕过业务 range 预筛）
 *
 * 用法:
 *   npm run diagnose:order-pay-time-gap
 *   npm run diagnose:order-pay-time-gap -- --month=2026-06
 *   npm run diagnose:order-pay-time-gap -- --days=180
 *   npm run diagnose:order-pay-time-gap -- --all
 */
import fs from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

const serverEnv = path.resolve(process.cwd(), 'apps/server/.env')
if (fs.existsSync(serverEnv)) loadEnv({ path: serverEnv })
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:../data/app.db'

import { prisma } from '../src/lib/prisma'
import { addDaysShanghai, formatDateKeyShanghai } from '../src/utils/business-timezone'
import { resolveDateRange } from '../src/utils/date-range'
import { resolveMonthlyReportRange } from '../src/services/monthly-operations-report.service'
import { runPayTimePrefilterDiagnostic } from '../src/services/order-pay-time-prefilter-diagnostic.service'

function parseArgs(): { month?: string; days: number; scanAll: boolean } {
  let month: string | undefined
  let days = 180
  let scanAll = false
  for (const arg of process.argv.slice(2)) {
    if (arg === '--all') scanAll = true
    else if (arg.startsWith('--month=')) month = arg.slice('--month='.length)
    else if (arg.startsWith('--days=')) {
      const n = Number(arg.slice('--days='.length))
      if (Number.isFinite(n) && n > 0) days = Math.round(n)
    }
  }
  return { month, days, scanAll }
}

async function main(): Promise<void> {
  const args = parseArgs()
  const today = formatDateKeyShanghai(new Date())

  const totalRaw = await prisma.xhsRawOrder.count()
  const useFullScan = args.scanAll || totalRaw <= 5000

  let paymentRange
  if (args.month?.trim()) {
    const { startDate, endDate } = resolveMonthlyReportRange({ month: args.month.trim() })
    paymentRange = resolveDateRange('custom', startDate, endDate)
  } else {
    const startDate = addDaysShanghai(today, -(args.days - 1))
    paymentRange = resolveDateRange('custom', startDate, today)
  }

  const result = await runPayTimePrefilterDiagnostic({
    paymentRange,
    scanAll: useFullScan,
    scanDays: useFullScan ? undefined : args.days,
  })

  const wouldMiss = result.rows.filter((r) => r.wouldMissWithCurrentPrefilter)

  console.log(
    JSON.stringify(
      {
        diagnoseMode: result.diagnoseMode,
        rawRowsScanned: result.rawRowsScanned,
        normalizedCount: result.normalizedCount,
        paymentRange: result.paymentRange,
        latePayOver30DaysCount: result.latePayOver30DaysCount,
        wouldMissWithCurrentPrefilterCount: result.wouldMissWithCurrentPrefilterCount,
        samples: result.rows.slice(0, 20),
        wouldMissSamples: wouldMiss.slice(0, 20),
        note: result.note,
      },
      null,
      2,
    ),
  )

  if (wouldMiss.length > 0) {
    console.error(
      `[diagnose:order-pay-time-gap] WARN: ${wouldMiss.length} 单可能被 orderTime 预筛漏掉（${result.diagnoseMode}，${result.rawRowsScanned} 条 raw）`,
    )
  } else {
    console.log(
      `[diagnose:order-pay-time-gap] OK（${result.diagnoseMode}，扫描 ${result.rawRowsScanned} 条 raw）`,
    )
  }
}

main()
  .catch((err) => {
    console.error('[diagnose:order-pay-time-gap] ERROR', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
