/**
 * 数据安全基线统计（修复前后对比用，只读不写库）
 * 用法: npx tsx apps/server/scripts/data-safety-baseline.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

const serverEnv = path.resolve(process.cwd(), 'apps/server/.env')
if (fs.existsSync(serverEnv)) {
  loadEnv({ path: serverEnv })
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:../data/app.db'
}
import { prisma } from '../src/lib/prisma'
import { resolveDateRange } from '../src/utils/date-range'
import { loadNormalizedOrdersFromRaw } from '../src/services/xhs-api-sync/xhs-json-normalizer.service'
import { orderPayTimeInRange } from '../src/utils/order-stat-time.util'

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:../data/app.db'
  const rel = url.replace(/^file:/, '').replace(/^\.\//, '')
  const candidates = [
    path.resolve(process.cwd(), 'apps/server/data/app.db'),
    path.resolve(process.cwd(), 'apps/server', rel),
    path.resolve(process.cwd(), rel),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

async function main(): Promise<void> {
  const dbPath = resolveDbPath()
  const dbExists = fs.existsSync(dbPath)
  console.log(JSON.stringify({ label: 'databasePath', value: dbPath, exists: dbExists }, null, 2))

  if (!dbExists) {
    console.log(JSON.stringify({ note: '本地数据库不存在，跳过统计' }))
    return
  }

  const range = resolveDateRange('last7')
  const orders = await loadNormalizedOrdersFromRaw({ range })
  const paidInRange = orders.filter((o) => orderPayTimeInRange(o, range) && o.errors.length === 0)
  const gmvCent = paidInRange.reduce((sum, o) => sum + o.gmvCent, 0)

  const [
    rawOrderCount,
    goodReviewCount,
    goodReviewSnapshotCount,
    liveSessionCount,
    anchorScheduleCount,
  ] = await Promise.all([
    prisma.xhsRawOrder.count(),
    prisma.goodReview.count(),
    prisma.goodReviewShopSnapshot.count(),
    prisma.xhsRawLiveSession.count(),
    prisma.anchorDailySchedule.count(),
  ])

  const stats = {
    capturedAt: new Date().toISOString(),
    databasePath: dbPath,
    rawOrderCount,
    goodReviewCount,
    goodReviewSnapshotCount,
    liveSessionCount,
    anchorScheduleCount,
    last7Days: {
      startDate: range.startDate,
      endDate: range.endDate,
      paidOrderCount: paidInRange.length,
      paymentGmvYuan: Math.round(gmvCent / 100),
    },
  }

  console.log(JSON.stringify(stats, null, 2))
}

main()
  .catch((err) => {
    console.error('[data-safety-baseline] ERROR', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
