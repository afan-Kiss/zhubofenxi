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
  AFTER_SALES_CACHE_ENSURE_COLUMNS,
  ensureAfterSalesQueueSchema,
  ensureAfterSalesSchemaOnce,
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
    await client.$executeRawUnsafe(`
      CREATE TABLE "XhsAfterSalesWorkbenchCache" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "liveAccountId" TEXT NOT NULL DEFAULT 'legacy',
        "orderNo" TEXT NOT NULL,
        "officialRefundAmountCent" INTEGER NOT NULL DEFAULT 0,
        "appliedShipFeeAmountCent" INTEGER NOT NULL DEFAULT 0,
        "refundIncludesFreight" BOOLEAN NOT NULL DEFAULT 0,
        "successReturnCount" INTEGER NOT NULL DEFAULT 0,
        "hasReturnRefund" BOOLEAN NOT NULL DEFAULT 0,
        "hasRefundOnly" BOOLEAN NOT NULL DEFAULT 0,
        "returnRefundCount" INTEGER NOT NULL DEFAULT 0,
        "refundOnlyCount" INTEGER NOT NULL DEFAULT 0,
        "fetchStatus" TEXT NOT NULL DEFAULT 'pending',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await client.$executeRawUnsafe(
      `INSERT INTO "XhsAfterSalesWorkbenchQueue" (id, liveAccountId, orderNo, status, attempts)
       VALUES ('q1', 'shopA', 'PLEGACY000000000001', 'pending', 0)`,
    )
    await client.$executeRawUnsafe(
      `INSERT INTO "XhsAfterSalesWorkbenchCache"
       (id, liveAccountId, orderNo, officialRefundAmountCent, appliedShipFeeAmountCent,
        refundIncludesFreight, successReturnCount, hasReturnRefund, hasRefundOnly,
        returnRefundCount, refundOnlyCount, fetchStatus)
       VALUES ('c1', 'shopA', 'PLEGACY000000000001', 12800, 0, 0, 1, 1, 0, 1, 0, 'success')`,
    )

    const before = await listSqliteTableColumns('XhsAfterSalesWorkbenchQueue', client)
    assert(!before.has('priority'), '旧库无 priority')
    assert(!before.has('claimToken'), '旧库无 claimToken')
    const beforeCache = await listSqliteTableColumns('XhsAfterSalesWorkbenchCache', client)
    assert(!beforeCache.has('matchedRecordCount'), '旧缓存无 matchedRecordCount')
    assert(!beforeCache.has('unknownRecordCount'), '旧缓存无 unknownRecordCount')

    resetAfterSalesQueueSchemaEnsureForTest()
    const once = await (
      await import('../src/services/after-sales-queue-schema-ensure.service')
    ).ensureAfterSalesSchemaOnce({ client })
    assert(once.queue.added.includes('priority'), 'queue 应补 priority')
    assert(once.cache.added.includes('matchedRecordCount'), 'cache 应补 matched')
    assert(once.cache.added.includes('unknownRecordCount'), 'cache 应补 unknown')

    const r1 = once
    assert(r1.added.includes('priority'), '应补 priority')
    assert(r1.added.includes('triggerReason'), '应补 triggerReason')
    assert(r1.added.includes('signalDetectedAt'), '应补 signalDetectedAt')
    assert(r1.added.includes('workerId'), '应补 workerId')
    assert(r1.added.includes('claimToken'), '应补 claimToken')

    const after = await listSqliteTableColumns('XhsAfterSalesWorkbenchQueue', client)
    for (const col of AFTER_SALES_QUEUE_ENSURE_COLUMNS) {
      assert(after.has(col.name), `缺列 ${col.name}`)
    }
    const afterCache = await listSqliteTableColumns('XhsAfterSalesWorkbenchCache', client)
    for (const col of AFTER_SALES_CACHE_ENSURE_COLUMNS) {
      assert(afterCache.has(col.name), `缓存缺列 ${col.name}`)
    }

    const rows = await client.$queryRawUnsafe<Array<{ id: string; orderNo: string }>>(
      `SELECT id, orderNo FROM "XhsAfterSalesWorkbenchQueue"`,
    )
    assert(rows.length === 1 && rows[0]!.orderNo === 'PLEGACY000000000001', '旧任务仍在')

    const caches = await client.$queryRawUnsafe<
      Array<{ orderNo: string; officialRefundAmountCent: number; fetchStatus: string }>
    >(`SELECT orderNo, officialRefundAmountCent, fetchStatus FROM "XhsAfterSalesWorkbenchCache"`)
    assert(caches.length === 1, '旧缓存仍在')
    assert(caches[0]!.officialRefundAmountCent === 12800, '金额未改')
    assert(caches[0]!.fetchStatus === 'success', 'fetchStatus 未改')

    // 幂等再跑
    const r2 = await ensureAfterSalesQueueSchema({ client })
    assert(r2.added.length === 0, '重复升级不加列')

    // Once 并发共享
    resetAfterSalesQueueSchemaEnsureForTest()
    const { ensureAfterSalesSchemaOnce } = await import(
      '../src/services/after-sales-queue-schema-ensure.service'
    )
    const onceA = ensureAfterSalesSchemaOnce({ client })
    const onceB = ensureAfterSalesSchemaOnce({ client })
    assert(onceA === onceB, 'Once 同 Promise')
    await Promise.all([onceA, onceB])

    // 能按新列查询（模拟 select）
    const due = await client.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "XhsAfterSalesWorkbenchQueue"
       WHERE status IN ('pending','retry_wait')
       ORDER BY priority DESC
       LIMIT 10`,
    )
    assert(due.length === 1, 'select 可用')

    // 数量字段写入后断开重连仍可读
    await client.$executeRawUnsafe(
      `UPDATE "XhsAfterSalesWorkbenchCache"
       SET matchedRecordCount=4, processingRecordCount=1, completedRecordCount=1,
           rejectedRecordCount=1, canceledRecordCount=1, closedRecordCount=0,
           unknownRecordCount=0, recordLifecycleSummary='PROCESSING,SUCCESS,REJECTED,CANCELED'
       WHERE orderNo='PLEGACY000000000001'`,
    )
    await client.$disconnect()

    const client2 = new PrismaClient({ datasources: { db: { url } } })
    try {
      const again = await client2.$queryRawUnsafe<
        Array<{
          matchedRecordCount: number
          processingRecordCount: number
          completedRecordCount: number
          rejectedRecordCount: number
          canceledRecordCount: number
          closedRecordCount: number
          unknownRecordCount: number
          recordLifecycleSummary: string | null
          officialRefundAmountCent: number
          fetchStatus: string
        }>
      >(
        `SELECT matchedRecordCount, processingRecordCount, completedRecordCount,
                rejectedRecordCount, canceledRecordCount, closedRecordCount,
                unknownRecordCount, recordLifecycleSummary,
                officialRefundAmountCent, fetchStatus
         FROM "XhsAfterSalesWorkbenchCache"
         WHERE orderNo='PLEGACY000000000001'`,
      )
      assert(again.length === 1, '重连后缓存仍在')
      assert(again[0]!.matchedRecordCount === 4, 'matched=4')
      assert(again[0]!.processingRecordCount === 1, 'processing=1')
      assert(again[0]!.completedRecordCount === 1, 'completed=1')
      assert(again[0]!.rejectedRecordCount === 1, 'rejected=1')
      assert(again[0]!.canceledRecordCount === 1, 'canceled=1')
      assert(again[0]!.closedRecordCount === 0, 'closed=0')
      assert(again[0]!.unknownRecordCount === 0, 'unknown=0')
      assert(again[0]!.officialRefundAmountCent === 12800, '金额仍在')
      assert(again[0]!.fetchStatus === 'success', 'status仍在')
    } finally {
      await client2.$disconnect()
    }

    resetAfterSalesQueueSchemaEnsureForTest()
    console.log('✓ after-sales-queue-schema-ensure-acceptance')
  } finally {
    try {
      await client.$disconnect()
    } catch {
      /* already disconnected */
    }
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
