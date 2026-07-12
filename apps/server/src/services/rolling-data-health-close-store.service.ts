import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataDir } from '../config/env'
import { logWarn } from '../utils/server-log'

const DATE_RANGE_KEY_RE = /^\d{4}-\d{2}-\d{2}__\d{4}-\d{2}-\d{2}$/

export const ROLLING_DATA_HEALTH_CLOSE_LOCK_STALE_MS = 2 * 60 * 60 * 1000

export interface RollingDataHealthCloseReport {
  generatedAt: string
  triggeredBy: string
  startDate: string
  endDate: string
  dataRangeLabel: string
  gmvAmountYuan: number
  actualSignedAmountYuan: number
  paidOrderCount: number
  signedOrderCount: number
  signRate: number | null
  refundAmountYuan: number
  refundOrderCount: number
  refundRate: number | null
  qualityRefundOrderCount: number
  qualityRefundRate: number | null
  /** @deprecated 兼容旧字段，等同 afterSaleSignalRecordCount（行级售后信号记录数） */
  afterSaleRecordCount: number
  afterSaleRelatedOrderCount: number
  afterSaleSignalRecordCount: number
  afterSaleCacheRecordCount: number
  afterSaleCacheRecordScope: 'all_db' | 'range'
  unassignedOrderCount: number
  duplicateOrderCount: number
  returnRefundOrderCount: number
  refundOnlyOrderCount: number
  unknownRefundTypeOrderCount: number
  classifiedRefundOrderCount: number
  returnRefundTypeIncomplete: boolean
  warnings: string[]
}

export interface RollingDataHealthCloseRunLogEntry {
  task: 'rolling-data-health-close'
  startDate: string
  endDate: string
  startedAt: string
  finishedAt: string
  status: 'pass' | 'failed'
  errorMessage?: string
  reportPath?: string
}

function reportsDir(): string {
  return path.join(getDataDir(), 'rolling-data-health-close-reports')
}

function runsLogPath(): string {
  return path.join(getDataDir(), 'rolling-data-health-close-runs.jsonl')
}

export function rollingDataHealthCloseReportFileKey(startDate: string, endDate: string): string {
  return `${startDate}__${endDate}`
}

export function rollingDataHealthCloseReportPath(startDate: string, endDate: string): string {
  const key = rollingDataHealthCloseReportFileKey(startDate, endDate)
  if (!DATE_RANGE_KEY_RE.test(key)) {
    throw new Error('startDate/endDate 格式应为 YYYY-MM-DD')
  }
  return path.join(reportsDir(), `${key}.json`)
}

export async function readRollingDataHealthCloseReport(
  startDate: string,
  endDate: string,
): Promise<RollingDataHealthCloseReport | null> {
  try {
    const raw = await fs.readFile(rollingDataHealthCloseReportPath(startDate, endDate), 'utf8')
    return JSON.parse(raw) as RollingDataHealthCloseReport
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function readLatestRollingDataHealthCloseReport(): Promise<RollingDataHealthCloseReport | null> {
  try {
    const raw = await fs.readFile(path.join(reportsDir(), 'latest.json'), 'utf8')
    return JSON.parse(raw) as RollingDataHealthCloseReport
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function writeRollingDataHealthCloseReport(
  report: RollingDataHealthCloseReport,
): Promise<string> {
  const dir = reportsDir()
  await fs.mkdir(dir, { recursive: true })
  const filePath = rollingDataHealthCloseReportPath(report.startDate, report.endDate)
  const payload = `${JSON.stringify(report, null, 2)}\n`
  await fs.writeFile(filePath, payload, 'utf8')
  await fs.writeFile(path.join(dir, 'latest.json'), payload, 'utf8')
  return filePath
}

export async function appendRollingDataHealthCloseRunLog(
  entry: RollingDataHealthCloseRunLogEntry,
): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true })
  await fs.appendFile(runsLogPath(), `${JSON.stringify(entry)}\n`, 'utf8')
}

function lockPath(): string {
  return path.join(getDataDir(), 'rolling-data-health-close.lock')
}

interface RollingDataHealthCloseLockPayload {
  rangeKey: string
  pid: number
  at: string
  triggeredBy: string
}

function isRollingCloseLockStale(at: string): boolean {
  const ms = Date.parse(at)
  if (!Number.isFinite(ms)) return true
  return Date.now() - ms > ROLLING_DATA_HEALTH_CLOSE_LOCK_STALE_MS
}

/** 若锁已过期则清理；返回 true 表示仍有有效锁 */
async function clearExpiredRollingCloseLockIfNeeded(): Promise<boolean> {
  const lockFile = lockPath()
  let raw: string
  try {
    raw = await fs.readFile(lockFile, 'utf8')
  } catch {
    return false
  }
  let payload: RollingDataHealthCloseLockPayload
  try {
    payload = JSON.parse(raw) as RollingDataHealthCloseLockPayload
  } catch {
    await fs.unlink(lockFile).catch(() => {})
    return false
  }
  if (isRollingCloseLockStale(payload.at ?? '')) {
    await fs.unlink(lockFile).catch(() => {})
    logWarn('滚动30天数据健康结账', '发现过期滚动结账锁，已自动清理')
    return false
  }
  return true
}

async function writeRollingCloseLock(
  lockFile: string,
  payload: RollingDataHealthCloseLockPayload,
): Promise<void> {
  await fs.writeFile(lockFile, JSON.stringify(payload), { flag: 'wx' })
}

export async function acquireRollingDataHealthCloseLock(
  rangeKey: string,
  triggeredBy: string,
): Promise<() => Promise<void>> {
  const lockFile = lockPath()
  const payload: RollingDataHealthCloseLockPayload = {
    rangeKey,
    pid: process.pid,
    at: new Date().toISOString(),
    triggeredBy,
  }
  await fs.mkdir(getDataDir(), { recursive: true })
  try {
    await writeRollingCloseLock(lockFile, payload)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const stillLocked = await clearExpiredRollingCloseLockIfNeeded()
      if (stillLocked) {
        throw new Error('滚动30天数据健康结账正在执行中，请稍后再试')
      }
      try {
        await writeRollingCloseLock(lockFile, payload)
      } catch (retryErr) {
        if ((retryErr as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error('滚动30天数据健康结账正在执行中，请稍后再试')
        }
        throw retryErr
      }
    } else {
      throw err
    }
  }
  return async () => {
    try {
      await fs.unlink(lockFile)
    } catch {
      /* ignore */
    }
  }
}

export async function isRollingDataHealthCloseLocked(): Promise<boolean> {
  try {
    await fs.access(lockPath())
  } catch {
    return false
  }
  return clearExpiredRollingCloseLockIfNeeded()
}

export async function readLastRollingDataHealthCloseRunLog(): Promise<RollingDataHealthCloseRunLogEntry | null> {
  try {
    const raw = await fs.readFile(runsLogPath(), 'utf8')
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return null
    return JSON.parse(lines[lines.length - 1]!) as RollingDataHealthCloseRunLogEntry
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
