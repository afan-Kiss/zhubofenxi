/**
 * 主播卡片走势曲线验收
 * 用法: npm run accept:anchor-trend
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import type { BoardLiveQueryPreset } from '../src/services/board-live-query.service'
import {
  resolveAnchorTrendMode,
  type AnchorTrend,
} from '../src/services/anchor-card-trend.service'
import { buildDailyReport } from '../src/services/daily-report.service'
import { addDaysShanghai, formatDateKeyShanghai } from '../src/utils/business-timezone'

config({ path: path.resolve(__dirname, '../.env') })

const HH_MM_RE = /^\d{1,2}:\d{2}$/
const MD_RE = /^\d{1,2}\/\d{1,2}$/

const DATA_NOT_READY_MSG =
  '生产库没有订单数据，无法完成 GMV>0 主播走势对账；请先同步订单或恢复 app.db。'
const NO_GMV_SAMPLE_MSG =
  '没有 GMV>0 主播样本，本次只能验证空结构，不能证明趋势金额正确。'

type CaseDef = {
  label: string
  preset: BoardLiveQueryPreset
  startDate?: string
  endDate?: string
  expectedMode: 'intraday' | 'daily'
}

type ReconcileRow = {
  scope: string
  anchorName: string
  cardGmv: number
  trendSum: number
  diff: number
  pass: boolean
}

type ScopeStats = {
  scope: string
  anchorCount: number
  gmvPositiveCount: number
  trendPositiveCount: number
}

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function near(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) <= eps
}

function readAnchorGmv(row: Record<string, unknown>): number {
  return Number(row.gmv ?? row.totalGmv ?? row.gmvYuan ?? 0)
}

function sumTrendValues(trend: AnchorTrend | undefined): number {
  return (trend?.points ?? []).reduce((s, p) => s + Number(p.value ?? 0), 0)
}

function countScopeStats(scope: string, rows: Array<Record<string, unknown>>): ScopeStats {
  let gmvPositiveCount = 0
  let trendPositiveCount = 0
  for (const row of rows) {
    const cardGmv = readAnchorGmv(row)
    const trendSum = sumTrendValues(row.trend as AnchorTrend | undefined)
    if (cardGmv > 0) gmvPositiveCount += 1
    if (trendSum > 0) trendPositiveCount += 1
  }
  return {
    scope,
    anchorCount: rows.length,
    gmvPositiveCount,
    trendPositiveCount,
  }
}

function printScopeStats(stats: ScopeStats): void {
  console.log(
    `[${stats.scope}] anchors=${stats.anchorCount} gmvPositive=${stats.gmvPositiveCount} trendPositive=${stats.trendPositiveCount}`,
  )
}

function printGmvPositiveDetail(
  scope: string,
  row: Record<string, unknown>,
  expectedMode: 'intraday' | 'daily',
): ReconcileRow {
  const anchorName = String(row.anchorName ?? '—')
  const trend = row.trend as AnchorTrend | undefined
  const cardGmv = readAnchorGmv(row)
  const trendSum = sumTrendValues(trend)
  const diff = trendSum - cardGmv
  const points = trend?.points ?? []
  const pass =
    Boolean(trend) &&
    trend!.metric === 'gmv' &&
    trend!.mode === expectedMode &&
    points.length > 0 &&
    near(trendSum, cardGmv)

  console.log(
    JSON.stringify(
      {
        scope,
        anchorName,
        cardGmv,
        trendSum,
        diff,
        mode: trend?.mode ?? null,
        pointCount: points.length,
        first5: points.slice(0, 5).map((p) => ({
          key: p.key,
          label: p.label,
          value: p.value,
          orderCount: p.orderCount,
          timeRange: p.timeRange ?? null,
          date: p.date ?? null,
        })),
        result: pass ? 'PASS' : 'FAIL',
      },
      null,
      2,
    ),
  )
  return { scope, anchorName, cardGmv, trendSum, diff, pass }
}

function printReconcile(scope: string, row: Record<string, unknown>): ReconcileRow {
  const anchorName = String(row.anchorName ?? '—')
  const cardGmv = readAnchorGmv(row)
  const trendSum = sumTrendValues(row.trend as AnchorTrend | undefined)
  const diff = trendSum - cardGmv
  const pass = cardGmv <= 0 && trendSum <= 0 ? true : near(trendSum, cardGmv)
  console.log(
    `主播：${anchorName}\n卡片销售额：${cardGmv.toFixed(2)}\n趋势合计：${trendSum.toFixed(2)}\n差异：${diff.toFixed(2)}\n结果：${pass ? 'PASS' : 'FAIL'}\n`,
  )
  return { scope, anchorName, cardGmv, trendSum, diff, pass }
}

function validateTrendForRow(
  row: Record<string, unknown>,
  expectedMode: 'intraday' | 'daily',
  label: string,
  issues: string[],
  reconciles: ReconcileRow[],
): void {
  const anchorName = String(row.anchorName ?? '—')
  const trend = row.trend as AnchorTrend | undefined
  assert(Boolean(trend), `${label} ${anchorName} 缺少 trend`, issues)
  if (!trend) return

  assert(trend.metric === 'gmv', `${label} ${anchorName} trend.metric 应为 gmv`, issues)
  assert(
    trend.mode === expectedMode,
    `${label} ${anchorName} trend.mode 应为 ${expectedMode}，实际 ${trend.mode}`,
    issues,
  )
  assert(Array.isArray(trend.points), `${label} ${anchorName} trend.points 必须是数组`, issues)
  assert(typeof trend.title === 'string' && trend.title.length > 0, `${label} ${anchorName} trend.title 缺失`, issues)

  const points = trend.points ?? []
  const keys = new Set<string>()
  for (const p of points) {
    assert(!keys.has(p.key), `${label} ${anchorName} trend point key 重复: ${p.key}`, issues)
    keys.add(p.key)

    if (expectedMode === 'intraday') {
      assert(
        HH_MM_RE.test(p.label),
        `${label} ${anchorName} intraday label 应为 HH:mm，实际 ${p.label}`,
        issues,
      )
      assert(
        !MD_RE.test(p.label),
        `${label} ${anchorName} intraday label 不应是日期格式 ${p.label}`,
        issues,
      )
    } else {
      assert(
        MD_RE.test(p.label),
        `${label} ${anchorName} daily label 应为 M/D，实际 ${p.label}`,
        issues,
      )
      assert(Boolean(p.date), `${label} ${anchorName} daily point 缺少 date`, issues)
    }
  }

  const cardGmv = readAnchorGmv(row)
  const trendSum = sumTrendValues(trend)
  if (cardGmv > 0 && points.length === 0) {
    issues.push(`主播 ${anchorName} 有销售额，但走势图为空，趋势数据漏算`)
  } else if (cardGmv > 0 || trendSum > 0) {
    assert(
      near(trendSum, cardGmv),
      `${label} ${anchorName} 曲线合计 ¥${trendSum.toFixed(2)} 与卡片 GMV ¥${cardGmv.toFixed(2)} 不一致`,
      issues,
    )
  }

  if (cardGmv > 0) {
    reconciles.push(printGmvPositiveDetail(label, row, expectedMode))
  } else {
    reconciles.push(printReconcile(label, row))
  }
}

function writeReport(report: Record<string, unknown>): void {
  const outPath = path.resolve(__dirname, '../../accept-anchor-trend-report.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
}

async function main() {
  const issues: string[] = []
  const reconciles: ReconcileRow[] = []
  const scopeStatsList: ScopeStats[] = []
  const today = formatDateKeyShanghai(new Date())
  const yesterday = addDaysShanghai(today, -1)

  const totalRawOrders = await prisma.xhsRawOrder.count()
  console.log(`[anchor-trend] totalRawOrders=${totalRawOrders}`)
  if (totalRawOrders === 0) {
    console.error(`DATA_NOT_READY: ${DATA_NOT_READY_MSG}`)
    writeReport({
      ok: false,
      status: 'DATA_NOT_READY',
      totalRawOrders,
      message: DATA_NOT_READY_MSG,
      checkedAt: new Date().toISOString(),
    })
    process.exit(2)
  }

  const cases: CaseDef[] = [
    { label: 'today', preset: 'today', expectedMode: 'intraday' },
    { label: 'yesterday', preset: 'yesterday', expectedMode: 'intraday' },
    { label: 'thisWeek', preset: 'thisWeek', expectedMode: 'daily' },
    { label: 'thisMonth', preset: 'thisMonth', expectedMode: 'daily' },
    { label: 'lastMonth', preset: 'lastMonth', expectedMode: 'daily' },
    {
      label: 'custom-single',
      preset: 'custom',
      startDate: today,
      endDate: today,
      expectedMode: 'intraday',
    },
    {
      label: 'custom-range',
      preset: 'custom',
      startDate: addDaysShanghai(today, -6),
      endDate: today,
      expectedMode: 'daily',
    },
  ]

  for (const c of cases) {
    const result = await executeBoardLocalQuery({
      preset: c.preset,
      startDate: c.startDate,
      endDate: c.endDate,
      role: 'admin',
    })

    const startDate = result.startDate
    const endDate = result.endDate
    const resolvedMode = resolveAnchorTrendMode({
      preset: c.preset,
      startDate,
      endDate,
    })
    assert(
      resolvedMode === c.expectedMode,
      `${c.label} resolveAnchorTrendMode 应为 ${c.expectedMode}，实际 ${resolvedMode}`,
      issues,
    )

    const leaderboard = (result.anchorLeaderboard ?? []) as Array<Record<string, unknown>>
    const stats = countScopeStats(c.label, leaderboard)
    scopeStatsList.push(stats)

    console.log(`\n=== ${c.label} 对账 ===`)
    printScopeStats(stats)

    for (const row of leaderboard) {
      validateTrendForRow(row, c.expectedMode, c.label, issues, reconciles)
    }

    console.log(
      `OK ${c.label}: mode=${c.expectedMode} anchors=${leaderboard.length} range=${startDate}~${endDate}`,
    )
  }

  console.log('\n=== 昨日日报图片数据源（复用主播卡片同一份 trend 数据）===')
  const dailyReport = await buildDailyReport({
    preset: 'custom',
    startDate: yesterday,
    endDate: yesterday,
    role: 'admin',
  })
  const dailyRows = dailyReport.anchors.map((row) => row as unknown as Record<string, unknown>)
  const dailyStats = countScopeStats(`daily-report:${yesterday}`, dailyRows)
  scopeStatsList.push(dailyStats)
  printScopeStats(dailyStats)

  for (const row of dailyReport.anchors) {
    const anchorName = row.anchorName
    const trend = row.trend
    assert(Boolean(trend), `daily-report ${anchorName} 缺少 trend`, issues)
    if (!trend) continue
    assert(trend.mode === 'intraday', `daily-report ${anchorName} trend.mode 必须为 intraday`, issues)
    assert(trend.metric === 'gmv', `daily-report ${anchorName} trend.metric 应为 gmv`, issues)
    for (const p of trend.points ?? []) {
      assert(
        HH_MM_RE.test(p.label),
        `daily-report ${anchorName} label 应为 HH:mm，实际 ${p.label}`,
        issues,
      )
      assert(
        !MD_RE.test(p.label),
        `daily-report ${anchorName} label 不应是日期格式 ${p.label}`,
        issues,
      )
    }
    const cardGmv = Number(row.gmvYuan ?? 0)
    const trendSum = sumTrendValues(trend)
    if (cardGmv > 0 && (trend.points?.length ?? 0) === 0) {
      issues.push(`daily-report 主播 ${anchorName} 有销售额，但走势图为空，趋势数据漏算`)
    } else if (cardGmv > 0 || trendSum > 0) {
      assert(
        near(trendSum, cardGmv),
        `daily-report ${anchorName} 曲线合计 ¥${trendSum.toFixed(2)} 与卡片 GMV ¥${cardGmv.toFixed(2)} 不一致`,
        issues,
      )
    }
    if (cardGmv > 0) {
      reconciles.push(
        printGmvPositiveDetail(`daily-report:${yesterday}`, row as unknown as Record<string, unknown>, 'intraday'),
      )
    } else {
      reconciles.push(
        printReconcile(`daily-report:${yesterday}`, row as unknown as Record<string, unknown>),
      )
    }
  }

  const totalGmvPositive = scopeStatsList.reduce((s, x) => s + x.gmvPositiveCount, 0)
  const gmvPositiveReconciles = reconciles.filter((r) => r.cardGmv > 0)

  const report = {
    ok: issues.length === 0 && totalGmvPositive > 0,
    status:
      issues.length > 0
        ? 'FAIL'
        : totalGmvPositive === 0
          ? 'NO_GMV_SAMPLE'
          : 'PASS',
    issueCount: issues.length,
    issues,
    reconciles,
    scopeStats: scopeStatsList,
    totalRawOrders,
    totalGmvPositiveAnchors: totalGmvPositive,
    gmvPositiveReconcileCount: gmvPositiveReconciles.length,
    dailyReportNote: '日报图片复用主播卡片同一份 trend 数据（buildDailyReport → enrichAnchorLeaderboardWithTrend）',
    checkedAt: new Date().toISOString(),
  }

  writeReport(report)

  if (totalGmvPositive === 0) {
    console.error(`NO_GMV_SAMPLE: ${NO_GMV_SAMPLE_MSG}`)
    for (const s of scopeStatsList) {
      console.error(
        `  - ${s.scope}: anchors=${s.anchorCount} gmvPositive=${s.gmvPositiveCount} trendPositive=${s.trendPositiveCount}`,
      )
    }
    process.exit(2)
  }

  if (issues.length > 0) {
    console.error('FAIL anchor-trend acceptance:')
    for (const i of issues) console.error(`  - ${i}`)
    process.exit(1)
  }

  const failedGmv = gmvPositiveReconciles.filter((r) => !r.pass)
  if (failedGmv.length > 0) {
    console.error('FAIL anchor-trend acceptance: GMV>0 主播对账未全部通过')
    for (const r of failedGmv) {
      console.error(`  - ${r.scope} ${r.anchorName}: cardGmv=${r.cardGmv} trendSum=${r.trendSum}`)
    }
    process.exit(1)
  }

  console.log(
    `PASS anchor-trend acceptance (rawOrders=${totalRawOrders}, gmvPositiveSamples=${gmvPositiveReconciles.length})`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
