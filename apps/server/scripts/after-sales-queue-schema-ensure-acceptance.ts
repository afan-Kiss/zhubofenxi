/**
 * 售后队列表 SQLite 缺列幂等升级验收
 * npx tsx apps/server/scripts/after-sales-queue-schema-ensure-acceptance.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  AFTER_SALES_QUEUE_ENSURE_COLUMNS,
  ensureAfterSalesQueueSchema,
  listSqliteTableColumns,
  resetAfterSalesQueueSchemaEnsureForTest,
} from '../src/services/after-sales-queue-schema-ensure.service'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-queue-schema-'))
  const dbPath = path.join(dir, 'legacy.db')
  const url = `file:${dbPath.replace(/\\/g, '/')}`

  const client = new PrismaClient({ datasources: { db: { url } } })
  try {
    // 旧版队列表：缺少 priority 等新列
    await client.$executeRawUnsafe(`
      CREATE TABLE "XhsAfterSalesWorkbenchQueue" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "liveAccountId" TEXT NOT NULL DEFAULT 'legacy',
        "orderNo" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "lastError" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await client.$executeRawUnsafe(
      `INSERT INTO "XhsAfterSalesWorkbenchQueue" (id, liveAccountId, orderNo, status, attempts)
       VALUES ('q1', 'shopA', 'PLEGACY000000000001', 'pending', 0)`,
    )

    const before = await listSqliteTableColumns('XhsAfterSalesWorkbenchQueue', client)
    assert(!before.has('priority'), '旧库无 priority')
    assert(!before.has('claimToken'), '旧库无 claimToken')

    const r1 = await ensureAfterSalesQueueSchema({ client })
    assert(r1.added.includes('priority'), '应补 priority')
    assert(r1.added.includes('triggerReason'), '应补 triggerReason')
    assert(r1.added.includes('signalDetectedAt'), '应补 signalDetectedAt')
    assert(r1.added.includes('workerId'), '应补 workerId')
    assert(r1.added.includes('claimToken'), '应补 claimToken')

    const after = await listSqliteTableColumns('XhsAfterSalesWorkbenchQueue', client)
    for (const col of AFTER_SALES_QUEUE_ENSURE_COLUMNS) {
      assert(after.has(col.name), `缺列 ${col.name}`)
    }

    const rows = await client.$queryRawUnsafe<Array<{ id: string; orderNo: string }>>(
      `SELECT id, orderNo FROM "XhsAfterSalesWorkbenchQueue"`,
    )
    assert(rows.length === 1 && rows[0]!.orderNo === 'PLEGACY000000000001', '旧任务仍在')

    // 幂等再跑
    const r2 = await ensureAfterSalesQueueSchema({ client })
    assert(r2.added.length === 0, '重复升级不加列')

    // 能按新列查询（模拟 select）
    const due = await client.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "XhsAfterSalesWorkbenchQueue"
       WHERE status IN ('pending','retry_wait')
       ORDER BY priority DESC
       LIMIT 10`,
    )
    assert(due.length === 1, 'select 可用')

    resetAfterSalesQueueSchemaEnsureForTest()
    console.log('✓ after-sales-queue-schema-ensure-acceptance')
  } finally {
    await client.$disconnect()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
