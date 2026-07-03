/**
 * 月度结账数据安全基线（只读）
 * 用法: npm run monthly:close-baseline
 *       npm run monthly:close-baseline -- --auto-prev-month
 */
import fs from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

const serverEnv = path.resolve(process.cwd(), 'apps/server/.env')
if (fs.existsSync(serverEnv)) loadEnv({ path: serverEnv })
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:../data/app.db'

import { buildMonthlyCloseDataSafetyBaseline } from '../src/services/monthly-close-reconciliation.service'
import { prisma } from '../src/lib/prisma'

function parseArgs(): { month?: string; autoPrevMonth?: boolean } {
  const out: { month?: string; autoPrevMonth?: boolean } = {}
  for (const arg of process.argv.slice(2)) {
    if (arg === '--auto-prev-month') out.autoPrevMonth = true
    else if (arg.startsWith('--month=')) out.month = arg.slice('--month='.length)
  }
  return out
}

function resolveDbPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'apps/server/data/app.db'),
    path.resolve(process.cwd(), 'apps/server', '../data/app.db'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

async function main(): Promise<void> {
  const args = parseArgs()
  const dbPath = resolveDbPath()
  console.log(JSON.stringify({ databasePath: dbPath, exists: fs.existsSync(dbPath) }, null, 2))

  const stats = await buildMonthlyCloseDataSafetyBaseline(
    args.month || args.autoPrevMonth ? args : { autoPrevMonth: true },
  )
  console.log(JSON.stringify(stats, null, 2))
}

main()
  .catch((err) => {
    console.error('[monthly:close-baseline] ERROR', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
