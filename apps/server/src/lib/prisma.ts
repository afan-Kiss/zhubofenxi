import { PrismaClient } from '@prisma/client'
import { logInfo, logWarn } from '../utils/server-log'

export const prisma = new PrismaClient()

let sqlitePragmasReady: Promise<void> | null = null

/** SQLite 并发读优化：WAL + busy_timeout，降低同步写库时页面读阻塞 */
export function ensureSqlitePragmas(): Promise<void> {
  if (sqlitePragmasReady) return sqlitePragmasReady
  sqlitePragmasReady = (async () => {
    try {
      await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL')
      await prisma.$executeRawUnsafe('PRAGMA busy_timeout=10000')
      await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL')
      logInfo('数据库', 'SQLite PRAGMA 已应用：WAL / busy_timeout=10000')
    } catch (err) {
      logWarn(
        '数据库',
        `SQLite PRAGMA 应用失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  })()
  return sqlitePragmasReady
}
