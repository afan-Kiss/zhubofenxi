/**
 * 售后队列表 SQLite 历史库幂等补列（不删表、不丢任务）
 */
import { prisma } from '../lib/prisma'
import { logInfo, logWarn } from '../utils/server-log'

const TABLE = 'XhsAfterSalesWorkbenchQueue'

type ColDef = {
  name: string
  ddl: string
}

/** 与 Prisma schema 对齐的可 ADD COLUMN 列表（幂等） */
export const AFTER_SALES_QUEUE_ENSURE_COLUMNS: ColDef[] = [
  { name: 'temporaryAttemptCount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'permanentFailureCount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'errorType', ddl: 'TEXT' },
  { name: 'nextAttemptAt', ddl: 'DATETIME' },
  { name: 'lastAttemptAt', ddl: 'DATETIME' },
  { name: 'completedAt', ddl: 'DATETIME' },
  { name: 'runningSince', ddl: 'DATETIME' },
  { name: 'workerId', ddl: 'TEXT' },
  { name: 'claimToken', ddl: 'TEXT' },
  { name: 'claimedAt', ddl: 'DATETIME' },
  { name: 'statusChangedAt', ddl: 'DATETIME' },
  { name: 'priority', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'triggerReason', ddl: 'TEXT' },
  { name: 'signalDetectedAt', ddl: 'DATETIME' },
]

export async function listSqliteTableColumns(
  tableName: string,
  client: { $queryRawUnsafe: <T = unknown>(q: string, ...args: unknown[]) => Promise<T> } = prisma,
): Promise<Set<string>> {
  const rows = await client.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${tableName}")`,
  )
  return new Set(rows.map((r) => String(r.name)))
}

export async function ensureAfterSalesQueueSchema(opts?: {
  client?: typeof prisma
  dryRun?: boolean
}): Promise<{ added: string[]; alreadyPresent: string[] }> {
  const client = opts?.client ?? prisma
  const existing = await listSqliteTableColumns(TABLE, client)
  if (existing.size === 0) {
    throw new Error(`ensureAfterSalesQueueSchema: table ${TABLE} missing`)
  }

  const added: string[] = []
  const alreadyPresent: string[] = []

  for (const col of AFTER_SALES_QUEUE_ENSURE_COLUMNS) {
    if (existing.has(col.name)) {
      alreadyPresent.push(col.name)
      continue
    }
    if (opts?.dryRun) {
      added.push(col.name)
      continue
    }
    await client.$executeRawUnsafe(
      `ALTER TABLE "${TABLE}" ADD COLUMN "${col.name}" ${col.ddl}`,
    )
    added.push(col.name)
  }

  if (added.length > 0 && !opts?.dryRun) {
    logInfo('数据库', `售后队列表补列完成：${added.join(',')}`)
  }

  // 幂等索引（SQLite IF NOT EXISTS）
  if (!opts?.dryRun) {
    try {
      await client.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "XhsAfterSalesWorkbenchQueue_liveAccountId_status_priority_nextAttemptAt_idx" ON "${TABLE}"("liveAccountId", "status", "priority", "nextAttemptAt")`,
      )
      await client.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "XhsAfterSalesWorkbenchQueue_status_nextAttemptAt_idx" ON "${TABLE}"("status", "nextAttemptAt")`,
      )
      await client.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "XhsAfterSalesWorkbenchQueue_liveAccountId_status_nextAttemptAt_idx" ON "${TABLE}"("liveAccountId", "status", "nextAttemptAt")`,
      )
    } catch (err) {
      logWarn(
        '数据库',
        `售后队列索引确保失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { added, alreadyPresent }
}

let ensureOnce: Promise<{ added: string[]; alreadyPresent: string[] }> | null = null

/** 启动时调用：失败仅 warning，不阻断 HTTP */
export function ensureAfterSalesQueueSchemaOnBoot(): Promise<{
  added: string[]
  alreadyPresent: string[]
}> {
  if (!ensureOnce) {
    ensureOnce = ensureAfterSalesQueueSchema().catch((err) => {
      ensureOnce = null
      logWarn(
        '数据库',
        `售后队列表补列失败：${err instanceof Error ? err.message : String(err)}`,
      )
      return { added: [], alreadyPresent: [] }
    })
  }
  return ensureOnce
}

/** 测试用：重置 once 缓存 */
export function resetAfterSalesQueueSchemaEnsureForTest(): void {
  ensureOnce = null
}
