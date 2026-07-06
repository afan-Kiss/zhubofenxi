import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataDir } from '../config/env'

const DATE_RANGE_KEY_RE = /^\d{4}-\d{2}-\d{2}__\d{4}-\d{2}-\d{2}$/

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
  afterSaleRecordCount: number
  unassignedOrderCount: number
  duplicateOrderCount: number
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
