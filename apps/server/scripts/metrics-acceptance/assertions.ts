import { MONEY_TOLERANCE_YUAN } from './golden-cases'

export type CheckOutcome = 'pass' | 'fail' | 'warn' | 'skip'

export interface CheckResult {
  name: string
  outcome: CheckOutcome
  message: string
  expected?: string | number
  actual?: string | number
  url?: string
  fields?: Record<string, unknown>
  hint?: string
}

const results: CheckResult[] = []

export function resetResults(): void {
  results.length = 0
}

export function getResults(): CheckResult[] {
  return [...results]
}

export function hasFailures(): boolean {
  return results.some((r) => r.outcome === 'fail')
}

function push(result: CheckResult): void {
  results.push(result)
  const prefix =
    result.outcome === 'pass'
      ? 'OK'
      : result.outcome === 'warn'
        ? 'WARN'
        : result.outcome === 'skip'
          ? 'SKIP'
          : 'FAIL'
  console.log(`[${result.name}] ${prefix} ${result.message}`)
}

export function logPass(name: string, message: string): void {
  push({ name, outcome: 'pass', message })
}

export function logWarn(name: string, message: string): void {
  push({ name, outcome: 'warn', message })
}

export function logSkip(name: string, message: string): void {
  push({ name, outcome: 'skip', message })
}

export function logFail(params: {
  name: string
  message: string
  expected?: string | number
  actual?: string | number
  url?: string
  fields?: Record<string, unknown>
  hint?: string
}): void {
  push({ ...params, outcome: 'fail' })
  console.error(`  expected: ${params.expected ?? '—'}`)
  console.error(`  actual: ${params.actual ?? '—'}`)
  if (params.url) console.error(`  url: ${params.url}`)
  if (params.fields) console.error(`  fields: ${JSON.stringify(params.fields)}`)
  if (params.hint) console.error(`  hint: ${params.hint}`)
}

export function moneyClose(a: number, b: number, tolerance = MONEY_TOLERANCE_YUAN): boolean {
  return Math.abs(a - b) <= tolerance + 1e-9
}

export function formatMoney(n: number): string {
  return n.toFixed(2)
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function pickPaidAmount(summary: Record<string, unknown>): number {
  return num(summary.totalGmv ?? summary.gmv ?? summary.productGmv)
}

export function pickPaidOrderCount(summary: Record<string, unknown>): number {
  return num(summary.orderCount ?? summary.paidOrderCount)
}

export function pickRefundAmount(summary: Record<string, unknown>): number {
  return num(summary.returnAmount ?? summary.productRefundAmount ?? summary.refundAmount)
}

export function pickQualityReturnCount(summary: Record<string, unknown>): number {
  return num(summary.qualityReturnCount ?? summary.qualityRefundOrderCount)
}

export function pickAnchorOrderCount(row: Record<string, unknown>): number {
  return num(row.orderCount ?? row.paidOrderCount)
}
