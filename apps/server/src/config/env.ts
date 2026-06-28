import fs from 'node:fs'
import path from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { logInfo, logWarn } from '../utils/server-log'

/** 编译后位于 apps/server/dist，上一级为 apps/server */
export const SERVER_ROOT = path.join(__dirname, '../..')

/** Prisma schema 目录；SQLite 的 DATABASE_URL 相对路径以此为基准 */
export const PRISMA_DIR = path.join(SERVER_ROOT, 'prisma')

/** 推荐值：相对 prisma/schema.prisma，指向 apps/server/data/app.db */
export const RECOMMENDED_DATABASE_URL = 'file:../data/app.db'

let loaded = false

export function loadEnv(): void {
  if (loaded) return
  const envPath = path.join(SERVER_ROOT, '.env')
  loadDotenv({ path: envPath })
  loaded = true
}

/** 开发：Vite 5173；生产同域 3001 时浏览器不跨域，此项主要供 dev 与反向代理场景 */
export function getCorsOrigin(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN ?? process.env.WEB_ORIGIN ?? ''
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (list.length === 0) {
    return process.env.NODE_ENV === 'production' ? true : 'http://localhost:5173'
  }
  if (list.length === 1) return list[0]!
  return list
}

export function isCookieSecure(): boolean {
  return process.env.COOKIE_SECURE === 'true'
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: isCookieSecure(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  }
}

export function getDataDir(): string {
  const dir = path.join(SERVER_ROOT, 'data')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getPort(): number {
  return Number(process.env.PORT ?? 4723)
}

/** 监听地址；生产 behind Nginx 建议 HOST=127.0.0.1 */
export function getListenHost(): string {
  const raw = process.env.HOST?.trim()
  if (raw) return raw
  return '0.0.0.0'
}

/** session=须登录；local=免登录本地看板（开发默认） */
export function getAuthMode(): 'session' | 'local' {
  const raw = process.env.AUTH_MODE?.trim().toLowerCase()
  if (raw === 'session' || raw === 'local') return raw
  if (process.env.NODE_ENV === 'production') return 'session'
  return 'local'
}

export function isRegistrationEnabled(): boolean {
  const raw = process.env.AUTH_ALLOW_REGISTER?.trim().toLowerCase()
  if (raw === 'false' || raw === '0') return false
  return true
}

const PLACEHOLDER_KEY = '请替换'

export function assertCookieEncryptionKey(): void {
  const key = process.env.COOKIE_ENCRYPTION_KEY?.trim()
  if (!key || key.length < 32 || key.includes(PLACEHOLDER_KEY)) {
    console.error(
      '[env] 缺少有效的 COOKIE_ENCRYPTION_KEY（至少 32 字符）。请在 apps/server/.env 中配置。',
    )
    process.exit(1)
  }
}

export function getDownloadDir(): string {
  const raw = process.env.DOWNLOAD_DIR ?? './data/downloads'
  const dir = path.isAbsolute(raw) ? raw : path.resolve(SERVER_ROOT, raw)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getReportDir(): string {
  const raw = process.env.REPORT_DIR ?? './data/reports'
  const dir = path.isAbsolute(raw) ? raw : path.resolve(SERVER_ROOT, raw)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getValidationPackageDir(): string {
  const raw = process.env.VALIDATION_PACKAGE_DIR ?? './data/validation-packages'
  const dir = path.isAbsolute(raw) ? raw : path.resolve(SERVER_ROOT, raw)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getBackupDir(): string {
  const raw = process.env.BACKUP_DIR ?? './data/backups'
  const dir = path.isAbsolute(raw) ? raw : path.resolve(SERVER_ROOT, raw)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getDatabasePath(): string {
  const url = process.env.DATABASE_URL ?? RECOMMENDED_DATABASE_URL
  const filePart = url.replace(/^file:/, '').trim()
  if (path.isAbsolute(filePart)) return filePart
  return path.resolve(PRISMA_DIR, filePart)
}

/** 历史误用路径：apps/server/prisma/data/app.db（勿作为运行库） */
export function getLegacyWrongDatabasePath(): string {
  return path.join(SERVER_ROOT, 'prisma', 'data', 'app.db')
}

export function logDatabaseStartupDiagnostics(): void {
  const databaseUrl = process.env.DATABASE_URL ?? RECOMMENDED_DATABASE_URL
  const absolutePath = getDatabasePath()
  logInfo('数据库', `DATABASE_URL=${databaseUrl}`)
  logInfo('数据库', `运行库路径=${absolutePath}`)

  if (databaseUrl.replace(/^file:/, '').trim() === './data/app.db') {
    logWarn(
      '数据库',
      'DATABASE_URL=file:./data/app.db 会被 Prisma 解析到错误路径，请改为 file:../data/app.db',
    )
  }

  const legacyPath = getLegacyWrongDatabasePath()
  if (fs.existsSync(legacyPath)) {
    const legacySize = fs.statSync(legacyPath).size
    if (legacySize === 0) {
      try {
        fs.unlinkSync(legacyPath)
        logInfo('数据库', '已清理旧错误库 apps/server/prisma/data/app.db（0 字节）')
      } catch (err) {
        logWarn(
          '数据库',
          `旧错误库 apps/server/prisma/data/app.db 删除失败：${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else {
      logWarn(
        '数据库',
        `检测到旧错误库 apps/server/prisma/data/app.db（${legacySize} 字节），当前运行库应为 apps/server/data/app.db，请人工确认后处理`,
      )
    }
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** 是否开放清空数据、维护补跑等危险维护接口（默认关闭） */
export function isMaintenanceToolsEnabled(): boolean {
  const v = process.env.ENABLE_MAINTENANCE_TOOLS?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** 直播场次导出 sellerId，DownloadConfig 未配置时使用 */
export function getXhsSellerId(): string | null {
  const fromEnv = process.env.XHS_SELLER_ID?.trim()
  return fromEnv || null
}

export function getMaxDownloadBytes(): number {
  const mb = Number(process.env.MAX_DOWNLOAD_SIZE_MB ?? 100)
  const safe = Number.isFinite(mb) && mb > 0 ? mb : 100
  return Math.floor(safe * 1024 * 1024)
}

/** 日志用：截断 URL，避免打印过长或敏感查询参数 */
export function truncateUrlForLog(url: string, max = 80): string {
  if (url.length <= max) return url
  return `${url.slice(0, max)}…`
}
