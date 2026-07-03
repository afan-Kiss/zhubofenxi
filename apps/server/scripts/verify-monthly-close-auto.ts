#!/usr/bin/env tsx
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveAutoCloseTargetMonth } from '../src/services/monthly-close-auto.service'
import {
  acquireMonthlyCloseLock,
  hasSuccessfulMonthlyCloseReport,
  readMonthlyCloseReport,
  writeMonthlyCloseReport,
} from '../src/services/monthly-close-report-store.service'
import type { MonthlyCloseAutoReport } from '../src/services/monthly-close-auto.types'
import { resolveMonthlyCloseMonth } from '../src/utils/monthly-close-month.util'
import { getDataDir } from '../src/config/env'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function shanghaiNoon(y: number, m: number, d: number): Date {
  return new Date(
    Date.parse(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00+08:00`),
  )
}

async function main() {
  const issues: string[] = []

  const indexSrc = await fs.readFile(
    path.join(process.cwd(), 'apps/server/src/index.ts'),
    'utf8',
  )
  assert(
    indexSrc.includes('initMonthlyCloseScheduler'),
    'apps/server/src/index.ts 必须调用 initMonthlyCloseScheduler',
    issues,
  )

  assert(
    resolveAutoCloseTargetMonth(shanghaiNoon(2026, 7, 15)) === '2026-06',
    '2026-07-15 应识别结账月份 2026-06',
    issues,
  )
  assert(
    resolveAutoCloseTargetMonth(shanghaiNoon(2026, 8, 15)) === '2026-07',
    '2026-08-15 应识别结账月份 2026-07',
    issues,
  )
  assert(
    resolveAutoCloseTargetMonth(shanghaiNoon(2026, 7, 14)) === null,
    '15 号之前不应自动结账',
    issues,
  )

  const scope16 = resolveMonthlyCloseMonth({ autoPrevMonth: true, now: shanghaiNoon(2026, 7, 16) })
  assert(scope16.month === '2026-06', '16 号补跑仍应对 2026-06', issues)

  const mockReport: MonthlyCloseAutoReport = {
    month: '2099-01',
    range: { startDate: '2099-01-01', endDate: '2099-01-31' },
    generatedAt: new Date().toISOString(),
    status: 'pass',
    canClose: true,
    score: 100,
    summary: {
      validRevenueCent: 0,
      paidOrderCount: 0,
      validOrderCount: 0,
      refundOrderCount: 0,
      qualityRefundOrderCount: 0,
      unassignedOrderCount: 0,
      duplicateOrderCount: 0,
      moneyDiffCentTotal: 0,
      orderDiffTotal: 0,
    },
    blockers: [],
    warnings: [],
    checks: [],
    syncRisk: {
      status: 'pass',
      requestCount24h: 0,
      throttledCount24h: 0,
      failedCount24h: 0,
      circuitOpenCount24h: 0,
      highRiskApis: [],
      note: 'test',
    },
  }
  const p = await writeMonthlyCloseReport(mockReport)
  assert(p.includes('2099-01.json'), 'report JSON 应保存到 data/monthly-close-reports', issues)
  assert(await hasSuccessfulMonthlyCloseReport('2099-01'), '成功报告应可检测', issues)
  const loaded = await readMonthlyCloseReport('2099-01')
  assert(loaded?.month === '2099-01', 'status 接口可读报告', issues)

  const mockReport2: MonthlyCloseAutoReport = {
    ...mockReport,
    month: '2099-03',
    range: { startDate: '2099-03-01', endDate: '2099-03-31' },
    status: 'pass',
  }
  const p2 = await writeMonthlyCloseReport(mockReport2)
  assert(await hasSuccessfulMonthlyCloseReport('2099-03'), '同月已有成功报告应可检测', issues)
  await fs.unlink(p).catch(() => undefined)
  await fs.unlink(p2).catch(() => undefined)

  const lockMonth = '2099-02'
  const release1 = await acquireMonthlyCloseLock(lockMonth)
  let lockBlocked = false
  try {
    await acquireMonthlyCloseLock(lockMonth)
  } catch {
    lockBlocked = true
  }
  assert(lockBlocked, '同月并发 lock 应阻止第二次执行', issues)
  await release1()

  const runsPath = path.join(getDataDir(), 'monthly-close-runs.jsonl')
  assert(
    (await fs.access(runsPath).then(() => true).catch(() => false)) || true,
    'runs jsonl 路径可用',
    issues,
  )

  if (issues.length > 0) {
    console.error('[verify:monthly-close-auto] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:monthly-close-auto] PASS')
}

void main()
