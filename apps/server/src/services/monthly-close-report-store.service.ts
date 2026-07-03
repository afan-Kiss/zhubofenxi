import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataDir } from '../config/env'
import type { MonthlyCloseAutoReport } from './monthly-close-auto.types'

const MONTH_KEY_RE = /^\d{4}-\d{2}$/

export interface MonthlyCloseRunLogEntry {
  task: 'monthly-close-auto'
  month: string
  startedAt: string
  finishedAt: string
  status: 'pass' | 'warning' | 'danger' | 'failed'
  errorMessage?: string
  reportPath?: string
}

function reportsDir(): string {
  return path.join(getDataDir(), 'monthly-close-reports')
}

function runsLogPath(): string {
  return path.join(getDataDir(), 'monthly-close-runs.jsonl')
}

function lockPath(): string {
  return path.join(getDataDir(), 'monthly-close-auto.lock')
}

export function monthlyCloseReportPath(month: string): string {
  if (!MONTH_KEY_RE.test(month)) throw new Error('month 格式应为 YYYY-MM')
  return path.join(reportsDir(), `${month}.json`)
}

export async function readMonthlyCloseReport(
  month: string,
): Promise<MonthlyCloseAutoReport | null> {
  try {
    const raw = await fs.readFile(monthlyCloseReportPath(month), 'utf8')
    return JSON.parse(raw) as MonthlyCloseAutoReport
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function writeMonthlyCloseReport(report: MonthlyCloseAutoReport): Promise<string> {
  const dir = reportsDir()
  await fs.mkdir(dir, { recursive: true })
  const filePath = monthlyCloseReportPath(report.month)
  await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return filePath
}

export async function appendMonthlyCloseRunLog(entry: MonthlyCloseRunLogEntry): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true })
  await fs.appendFile(runsLogPath(), `${JSON.stringify(entry)}\n`, 'utf8')
}

export async function listMonthlyCloseReportMonths(): Promise<string[]> {
  try {
    const files = await fs.readdir(reportsDir())
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((m) => MONTH_KEY_RE.test(m))
      .sort()
  } catch {
    return []
  }
}

export async function readLatestMonthlyCloseReport(): Promise<MonthlyCloseAutoReport | null> {
  const months = await listMonthlyCloseReportMonths()
  if (months.length === 0) return null
  return readMonthlyCloseReport(months[months.length - 1]!)
}

export async function acquireMonthlyCloseLock(month: string): Promise<() => Promise<void>> {
  const lockFile = lockPath()
  try {
    await fs.mkdir(getDataDir(), { recursive: true })
    await fs.writeFile(lockFile, JSON.stringify({ month, pid: process.pid, at: new Date().toISOString() }), {
      flag: 'wx',
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`月度结账任务正在执行中（${month}），请勿并发重跑`)
    }
    throw err
  }
  return async () => {
    try {
      await fs.unlink(lockFile)
    } catch {
      /* ignore */
    }
  }
}

export async function isMonthlyCloseLocked(): Promise<boolean> {
  try {
    await fs.access(lockPath())
    return true
  } catch {
    return false
  }
}

export async function hasSuccessfulMonthlyCloseReport(month: string): Promise<boolean> {
  const report = await readMonthlyCloseReport(month)
  if (!report) return false
  return report.status === 'pass' || report.status === 'warning'
}
