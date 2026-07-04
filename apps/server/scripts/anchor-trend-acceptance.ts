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

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function near(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) <= eps
}

function readAnchorGmv(row: Record<string, unknown>): number {
  return Number(row.gmv ?? row.totalGmv ?? 0)
}

function validateTrendForRow(
  row: Record<string, unknown>,
  expectedMode: 'intraday' | 'daily',
  label: string,
  issues: string[],
): void {
  const anchorName = String(row.anchorName ?? '—')
  const trend = row.trend as AnchorTrend | undefined
  assert(Boolean(trend), `${label} ${anchorName} 缺少 trend`, issues)
  if (!trend) return

  assert(trend.metric === 'gmv', `${label} ${anchorName} trend.metric 应为 gmv`, issues)
  assert(trend.mode === expectedMode, `${label} ${anchorName} trend.mode 应为 ${expectedMode}，实际 ${trend.mode}`, issues)
  assert(Array.isArray(trend.points), `${label} ${anchorName} trend.points 必须是数组`, issues)
  assert(typeof trend.title === 'string' && trend.title.length > 0, `${label} ${anchorName} trend.title 缺失`, issues)

  const points = trend.points ?? []
  const keys = new Set<string>()
  for (const p of points) {
    assert(!keys.has(p.key), `${label} ${anchorName} trend point key 重复: ${p.key}`, issues)
    keys.add(p.key)

    if (expectedMode === 'intraday') {
      assert(HH_MM_RE.test(p.label), `${label} ${anchorName} intraday label 应为 HH:mm，实际 ${p.label}`, issues)
      assert(!MD_RE.test(p.label), `${label} ${anchorName} intraday label 不应是日期格式 ${p.label}`, issues)
    } else {
      assert(MD_RE.test(p.label), `${label} ${anchorName} daily label 应为 M/D，实际 ${p.label}`, issues)
      assert(Boolean(p.date), `${label} ${anchorName} daily point 缺少 date`, issues)
    }
  }

  const trendSum = points.reduce((s, p) => s + Number(p.value ?? 0), 0)
  const cardGmv = readAnchorGmv(row)
  if (cardGmv > 0 || trendSum > 0) {
    assert(
      near(trendSum, cardGmv),
      `${label} ${anchorName} 曲线合计 ¥${trendSum.toFixed(2)} 与卡片 GMV ¥${cardGmv.toFixed(2)} 不一致`,
      issues,
    )
  }
}

async function main() {
  const issues: string[] = []
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

    for (const row of leaderboard) {
      validateTrendForRow(row, c.expectedMode, c.label, issues)
    }

    console.log(
      `OK ${c.label}: mode=${c.expectedMode} anchors=${leaderboard.length} range=${startDate}~${endDate}`,
    )
  }

  const report = {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
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
