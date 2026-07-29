/**
 * 售后相关 SQLite 历史库幂等补列（Queue + WorkbenchCache）+ 全局就绪状态
 *
 * 生产历史库不一定跑 Prisma migrate，启动/回填必须统一走 ensureAfterSalesSchemaOnce。
 */
import { prisma } from '../lib/prisma'
import { logInfo, logWarn } from '../utils/server-log'

const QUEUE_TABLE = 'XhsAfterSalesWorkbenchQueue'
const CACHE_TABLE = 'XhsAfterSalesWorkbenchCache'

type ColDef = { name: string; ddl: string }

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

export const AFTER_SALES_CACHE_ENSURE_COLUMNS: ColDef[] = [
  { name: 'matchedRecordCount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'processingRecordCount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'completedRecordCount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'rejectedRecordCount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'canceledRecordCount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'closedRecordCount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'unknownRecordCount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'recordLifecycleSummary', ddl: 'TEXT' },
]

export type TableSchemaEnsureResult = { added: string[]; alreadyPresent: string[] }

export type AfterSalesSchemaEnsureResult = {
  queue: TableSchemaEnsureResult
  cache: TableSchemaEnsureResult
  added: string[]
  alreadyPresent: string[]
}

export type QueueSchemaState =
  | { status: 'unknown' }
  | { status: 'ready'; checkedAt: Date }
  | { status: 'failed'; error: string; checkedAt: Date }

const GLOBAL = globalThis as {
  __afterSalesQueueSchemaState?: QueueSchemaState
  __afterSalesSchemaOnce?: Promise<AfterSalesSchemaEnsureResult> | null
  /** @deprecated 兼容旧全局键 */
  __afterSalesQueueSchemaOnce?: Promise<AfterSalesSchemaEnsureResult> | null
}

function getState(): QueueSchemaState {
  return GLOBAL.__afterSalesQueueSchemaState ?? { status: 'unknown' }
}

function setState(state: QueueSchemaState): void {
  GLOBAL.__afterSalesQueueSchemaState = state
}

export function getAfterSalesQueueSchemaState(): QueueSchemaState {
  return getState()
}

export function getAfterSalesSchemaState(): QueueSchemaState {
  return getState()
}

export async function listSqliteTableColumns(
  tableName: string,
  client: { $queryRawUnsafe: <T = unknown>(q: string, ...args: unknown[]) => Promise<T> } = prisma,
): Promise<Set<string>> {
  const rows = await client.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${tableName}")`,
  )
  return new Set(rows.map((r) => String(r.name)))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** 锁退避：初次失败→100ms→300ms→800ms→最终抛错（最多 4 次 ALTER） */
export const AFTER_SALES_SCHEMA_LOCK_RETRY_DELAYS_MS = [100, 300, 800] as const

export type AddColumnRetryHooks = {
  sleep?: (ms: number) => Promise<void>
  /** 测试用：覆盖 ALTER 执行 */
  executeAlter?: () => Promise<void>
}

export async function addSqliteColumnWithRetry(
  client: typeof prisma,
  table: string,
  col: ColDef,
  hooks?: AddColumnRetryHooks,
): Promise<'added' | 'exists'> {
  const sleepFn = hooks?.sleep ?? sleep
  const delays = AFTER_SALES_SCHEMA_LOCK_RETRY_DELAYS_MS
  let lastErr: unknown

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      if (hooks?.executeAlter) {
        await hooks.executeAlter()
      } else {
        await client.$executeRawUnsafe(
          `ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${col.ddl}`,
        )
      }
      return 'added'
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)

      if (/duplicate column name/i.test(msg)) {
        const cols = await listSqliteTableColumns(table, client)
        if (cols.has(col.name)) return 'exists'
        throw err instanceof Error ? err : new Error(msg)
      }

      const locked = /database is locked|SQLITE_BUSY/i.test(msg)
      if (locked) {
        const cols = await listSqliteTableColumns(table, client)
        if (cols.has(col.name)) return 'exists'
        if (attempt >= delays.length) {
          throw err instanceof Error ? err : new Error(msg)
        }
        await sleepFn(delays[attempt]!)
        continue
      }

      const cols = await listSqliteTableColumns(table, client)
      if (cols.has(col.name)) return 'exists'
      throw err instanceof Error ? err : new Error(msg)
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function addColumnWithRetry(
  client: typeof prisma,
  table: string,
  col: ColDef,
): Promise<'added' | 'exists'> {
  return addSqliteColumnWithRetry(client, table, col)
}

async function ensureColumns(
  client: typeof prisma,
  table: string,
  columns: ColDef[],
  dryRun?: boolean,
): Promise<TableSchemaEnsureResult> {
  const existing = await listSqliteTableColumns(table, client)
  if (existing.size === 0) {
    throw new Error(`ensureAfterSalesSchema: table ${table} missing`)
  }
  const added: string[] = []
  const alreadyPresent: string[] = []
  for (const col of columns) {
    if (existing.has(col.name)) {
      alreadyPresent.push(col.name)
      continue
    }
    if (dryRun) {
      added.push(col.name)
      continue
    }
    const r = await addColumnWithRetry(client, table, col)
    if (r === 'added') added.push(col.name)
    else alreadyPresent.push(col.name)
  }
  return { added, alreadyPresent }
}

export async function ensureAfterSalesQueueTableSchema(opts?: {
  client?: typeof prisma
  dryRun?: boolean
}): Promise<TableSchemaEnsureResult> {
  const client = opts?.client ?? prisma
  const result = await ensureColumns(
    client,
    QUEUE_TABLE,
    AFTER_SALES_QUEUE_ENSURE_COLUMNS,
    opts?.dryRun,
  )
  if (!opts?.dryRun) {
    try {
      await client.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "XhsAfterSalesWorkbenchQueue_liveAccountId_status_priority_nextAttemptAt_idx" ON "${QUEUE_TABLE}"("liveAccountId", "status", "priority", "nextAttemptAt")`,
      )
      await client.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "XhsAfterSalesWorkbenchQueue_status_nextAttemptAt_idx" ON "${QUEUE_TABLE}"("status", "nextAttemptAt")`,
      )
      await client.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "XhsAfterSalesWorkbenchQueue_liveAccountId_status_nextAttemptAt_idx" ON "${QUEUE_TABLE}"("liveAccountId", "status", "nextAttemptAt")`,
      )
    } catch (err) {
      logWarn(
        '数据库',
        `售后队列索引确保失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return result
}

export async function ensureAfterSalesWorkbenchCacheTableSchema(opts?: {
  client?: typeof prisma
  dryRun?: boolean
}): Promise<TableSchemaEnsureResult> {
  const client = opts?.client ?? prisma
  return ensureColumns(client, CACHE_TABLE, AFTER_SALES_CACHE_ENSURE_COLUMNS, opts?.dryRun)
}

export async function ensureAfterSalesSchema(opts?: {
  client?: typeof prisma
  dryRun?: boolean
}): Promise<AfterSalesSchemaEnsureResult> {
  const queue = await ensureAfterSalesQueueTableSchema(opts)
  const cache = await ensureAfterSalesWorkbenchCacheTableSchema(opts)
  const added = [...queue.added, ...cache.added]
  const alreadyPresent = [...queue.alreadyPresent, ...cache.alreadyPresent]
  if (added.length > 0 && !opts?.dryRun) {
    logInfo(
      '数据库',
      `售后表补列完成：queue=[${queue.added.join(',') || '无'}] cache=[${cache.added.join(',') || '无'}]`,
    )
  }
  return { queue, cache, added, alreadyPresent }
}

/** @deprecated 使用 ensureAfterSalesSchema；仍升级 Queue+Cache 两张表 */
export async function ensureAfterSalesQueueSchema(opts?: {
  client?: typeof prisma
  dryRun?: boolean
}): Promise<{ added: string[]; alreadyPresent: string[] }> {
  const r = await ensureAfterSalesSchema(opts)
  return { added: r.added, alreadyPresent: r.alreadyPresent }
}

function getOncePromise(): Promise<AfterSalesSchemaEnsureResult> | null {
  return GLOBAL.__afterSalesSchemaOnce ?? GLOBAL.__afterSalesQueueSchemaOnce ?? null
}

function setOncePromise(p: Promise<AfterSalesSchemaEnsureResult> | null): void {
  GLOBAL.__afterSalesSchemaOnce = p
  GLOBAL.__afterSalesQueueSchemaOnce = p
}

/**
 * 进程内单例：同时升级 Queue + WorkbenchCache。
 * 失败清空 Promise 并标记 failed，不得伪装成功。
 */
export function ensureAfterSalesSchemaOnce(opts?: {
  client?: typeof prisma
}): Promise<AfterSalesSchemaEnsureResult> {
  const existing = getOncePromise()
  if (existing) return existing
  const promise = ensureAfterSalesSchema(opts)
    .then((r) => {
      setState({ status: 'ready', checkedAt: new Date() })
      return r
    })
    .catch((err) => {
      setOncePromise(null)
      const message = err instanceof Error ? err.message : String(err)
      setState({ status: 'failed', error: message, checkedAt: new Date() })
      throw err instanceof Error ? err : new Error(message)
    })
  setOncePromise(promise)
  return promise
}

/** @deprecated 使用 ensureAfterSalesSchemaOnce */
export function ensureAfterSalesQueueSchemaOnce(opts?: {
  client?: typeof prisma
}): Promise<AfterSalesSchemaEnsureResult> {
  return ensureAfterSalesSchemaOnce(opts)
}

/** 启动：捕获失败并记录，不阻断 HTTP；失败状态供回填检查 */
export function ensureAfterSalesQueueSchemaOnBoot(): Promise<AfterSalesSchemaEnsureResult | null> {
  return ensureAfterSalesSchemaOnce().catch((err) => {
    logWarn(
      '数据库',
      `售后表（Queue+Cache）补列失败：${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  })
}

export function resetAfterSalesQueueSchemaEnsureForTest(): void {
  setOncePromise(null)
  setState({ status: 'unknown' })
}
