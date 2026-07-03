/**
 * 支付时间预筛漏单诊断（只读，扫描最近 180 天）
 * 用法: npm run diagnose:order-pay-time-gap
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
import {
  diagnosePayTimePrefilterGapFromOrders,
} from '../src/services/monthly-close-reconciliation.service'
import {
  loadNormalizedOrdersFromRaw,
} from '../src/services/xhs-api-sync/xhs-json-normalizer.service'

async function main(): Promise<void> {
  const today = formatDateKeyShanghai(new Date())
  const startDate = addDaysShanghai(today, -179)
  const range = resolveDateRange('custom', startDate, today)

  const allInWindow = await loadNormalizedOrdersFromRaw({ range })
  const gaps = diagnosePayTimePrefilterGapFromOrders(allInWindow, range)
  const wouldMiss = gaps.filter((g) => g.wouldMissWithCurrentPrefilter)

  console.log(
    JSON.stringify(
      {
        scanRange: { startDate, endDate: today },
        totalOrdersLoaded: allInWindow.length,
        latePayOver30DaysCount: gaps.length,
        wouldMissWithCurrentPrefilterCount: wouldMiss.length,
        samples: gaps.slice(0, 20),
        wouldMissSamples: wouldMiss.slice(0, 20),
        note:
          wouldMiss.length > 0
            ? '存在下单与支付相差超过30天且可能被 orderTime 预筛漏掉的订单，需关注'
            : '未发现明显预筛漏单样本（在180天窗口内）',
      },
      null,
      2,
    ),
  )

  if (wouldMiss.length > 0) {
    console.error(`[diagnose:order-pay-time-gap] WARN: ${wouldMiss.length} 单可能被预筛漏掉`)
    process.exitCode = 0
  } else {
    console.log('[diagnose:order-pay-time-gap] PASS')
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
