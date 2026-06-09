import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { resolveDateRange } from '../src/utils/date-range'
import { runAnalysisPipelineFromXhsRaw } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'

config({ path: path.resolve(__dirname, '../.env') })
const prisma = new PrismaClient()

async function main(): Promise<void> {
  const range = resolveDateRange('custom', '2026-05-28', '2026-05-28')
  const p = await runAnalysisPipelineFromXhsRaw(range)
  console.log('trust', p?.trustStatus)
  console.log('errors', p?.validation?.errors)
  console.log('warnings', p?.validation?.warnings)
  if (p?.result?.overview) {
    const o = p.result.overview as { gmvCent?: number; orderCount?: number }
    console.log('gmvCent', o.gmvCent, 'orders', o.orderCount)
  }
}

main()
  .catch(console.error)
  .finally(() => void prisma.$disconnect())
