/**
 * 手动更新上月经营总览稳定快照
 * 用法: npm run update:overview-stable-snapshot
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { forceUpdateLastMonthStableSnapshot } from '../src/services/overview-metric-snapshot.service'

config({ path: path.resolve(__dirname, '../.env') })

async function main(): Promise<void> {
  const result = await forceUpdateLastMonthStableSnapshot()
  console.log('上月稳定快照已更新:')
  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
