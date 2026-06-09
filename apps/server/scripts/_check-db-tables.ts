import { loadEnv, getDatabasePath, SERVER_ROOT } from '../src/config/env'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

loadEnv()

async function main() {
  console.log('cwd', process.cwd())
  console.log('DATABASE_URL', process.env.DATABASE_URL)
  console.log('resolved', getDatabasePath())

  const p = new PrismaClient()
  try {
    const tables = await p.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    )
    console.log('tableCount', tables.length)
    console.log('has SystemSetting', tables.some((t) => t.name === 'SystemSetting'))
    console.log('has _prisma_migrations', tables.some((t) => t.name === '_prisma_migrations'))
    if (tables.some((t) => t.name === 'SystemSetting')) {
      console.log('settings', await p.systemSetting.count())
      console.log('orders', await p.xhsRawOrder.count())
    }
  } finally {
    await p.$disconnect()
  }
}

main().catch(console.error)
