import { PrismaClient } from '@prisma/client'

async function probe(label: string, url: string) {
  process.env.DATABASE_URL = url
  const p = new PrismaClient()
  try {
    const users = await p.user.count()
    const orders = await p.xhsRawOrder.count()
    const failed = await p.$queryRawUnsafe<Array<{ migration_name: string; finished_at: string | null }>>(
      `SELECT migration_name, finished_at FROM _prisma_migrations WHERE finished_at IS NULL`,
    )
    console.log(JSON.stringify({ label, url, users, orders, failedMigrations: failed.length, failed }))
  } finally {
    await p.$disconnect()
  }
}

async function main() {
  await probe('intended', 'file:../data/app.db')
}

main().catch(console.error)
