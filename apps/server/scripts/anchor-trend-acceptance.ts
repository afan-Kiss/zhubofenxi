/**
 * 主播卡片走势曲线验收
 * 用法: npm run accept:anchor-trend
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
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

  reconciles.push(printReconcile(label, row))
}

async function main() {
  const issues: string[] = []
  const reconciles: ReconcileRow[] = []
  const today = formatDateKeyShanghai(new Date())
  const yesterday = addDaysShanghai(today, -1)

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

    const leaderboard = result.anchorLeaderboard ?? []
    assert(leaderboard.length >= 0, `${c.label} anchorLeaderboard 查询失败`, issues)

    console.log(`\n=== ${c.label} 对账 ===`)
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
    reconciles.push(
      printReconcile(`daily-report:${yesterday}`, row as unknown as Record<string, unknown>),
    )
  }

  const report = {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    reconciles,
    dailyReportNote: '日报图片复用主播卡片同一份 trend 数据（buildDailyReport → enrichAnchorLeaderboardWithTrend）',
    checkedAt: new Date().toISOString(),
  }

  const outPath = path.resolve(__dirname, '../../accept-anchor-trend-report.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')

  if (issues.length > 0) {
    console.error('FAIL anchor-trend acceptance:')
    for (const i of issues) console.error(`  - ${i}`)
    process.exit(1)
  }

  console.log('PASS anchor-trend acceptance')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
