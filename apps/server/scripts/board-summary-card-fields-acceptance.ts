/**
 * 经营总览顶部 9 卡片字段验收
 * 用法: npm run accept:board-summary-cards
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import type { BoardLiveQueryPreset } from '../src/services/board-live-query.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'

config({ path: path.resolve(__dirname, '../.env') })

const REQUIRED_SUMMARY_FIELDS = [
  'orderCount',
  'totalGmv',
  'actualSignedAmount',
  'signedOrderCount',
  'signRate',
  'returnAmount',
  'returnRate',
  'qualityReturnCount',
  'returnCount',
] as const

const PRESETS: Array<{ preset: BoardLiveQueryPreset; startDate?: string; endDate?: string }> = [
  { preset: 'today' },
  { preset: 'yesterday' },
  { preset: 'thisWeek' },
  { preset: 'thisMonth' },
  { preset: 'lastMonth' },
  {
    preset: 'custom',
    startDate: '2026-06-01',
    endDate: '2026-06-07',
  },
]

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isRateValue(v: unknown): boolean {
  return v == null || isNumber(v)
}

function near(a: number, b: number, eps = 0.0001): boolean {
  return Math.abs(a - b) <= eps
}

function validateSummary(
  summary: Record<string, unknown>,
  label: string,
  issues: string[],
): void {
  for (const key of REQUIRED_SUMMARY_FIELDS) {
    assert(key in summary, `${label} summary 缺少字段 ${key}`, issues)
  }

  for (const key of ['totalGmv', 'actualSignedAmount', 'returnAmount'] as const) {
    assert(isNumber(summary[key]), `${label} ${key} 必须是 number`, issues)
  }

  for (const key of ['orderCount', 'signedOrderCount', 'qualityReturnCount', 'returnCount'] as const) {
    assert(isNumber(summary[key]), `${label} ${key} 必须是 number`, issues)
  }

  assert(isRateValue(summary.signRate), `${label} signRate 必须是 number 或 null`, issues)
  assert(isRateValue(summary.returnRate), `${label} returnRate 必须是 number 或 null`, issues)

  const orderCount = Number(summary.orderCount ?? 0)
  const signedOrderCount = Number(summary.signedOrderCount ?? 0)
  const returnCount = Number(summary.returnCount ?? 0)
  const signRate = summary.signRate
  const returnRate = summary.returnRate

  if (orderCount > 0) {
    if (isNumber(signRate)) {
      assert(
        near(signRate, signedOrderCount / orderCount),
        `${label} signRate 应等于 signedOrderCount/orderCount，实际 ${signRate} vs ${signedOrderCount}/${orderCount}`,
        issues,
      )
    }
    if (isNumber(returnRate)) {
      assert(
        near(returnRate, returnCount / orderCount),
        `${label} returnRate 应等于 returnCount/orderCount，实际 ${returnRate} vs ${returnCount}/${orderCount}`,
        issues,
      )
    }
  } else {
    assert(
      signRate == null || signRate === 0,
      `${label} orderCount=0 时 signRate 应为 null 或 0`,
      issues,
    )
    assert(
      returnRate == null || returnRate === 0,
      `${label} orderCount=0 时 returnRate 应为 null 或 0`,
      issues,
    )
  }
}

function validateOverviewTabUi(issues: string[]) {
  const file = path.resolve(__dirname, '../../web/src/pages/board/OverviewTab.tsx')
  const src = fs.readFileSync(file, 'utf-8')

  const forbiddenLabels = ['有效成交额', '品退率', '直播场次', '主播人数', '支付订单数', '签收单数', '退款单数', '品退单数']
  for (const label of forbiddenLabels) {
    assert(!src.includes(`label="${label}"`), `OverviewTab 不应展示卡片「${label}」`, issues)
    assert(!src.includes(`label={'${label}'}`), `OverviewTab 不应展示卡片「${label}」`, issues)
    assert(!src.includes(`label={\"${label}\"}`), `OverviewTab 不应展示卡片「${label}」`, issues)
  }

  const requiredLabels = [
    '本期总订单数',
    '本期销售额[GMV]',
    '实际签收金额',
    '实际签收订单数',
    '签收率',
    '退款金额',
    '退款率',
    '品退订单数',
    '退款订单数',
  ]
  for (const label of requiredLabels) {
    assert(src.includes(label), `OverviewTab 应展示卡片「${label}」`, issues)
  }

  assert(!src.includes('showLongPeriodRates'), 'OverviewTab 不应再按短周期隐藏签收率/退款率', issues)
  assert(!src.includes('validSalesAmount'), 'OverviewTab 不应绑定有效成交额卡片', issues)
  assert(!src.includes('qualityReturnRate'), 'OverviewTab 不应展示品退率卡片', issues)

  assert(
    src.includes('xl:grid-cols-5') || src.includes('SUMMARY_CARDS'),
    'OverviewTab 应使用统一 grid 渲染 9 卡片',
    issues,
  )
  assert(
    src.includes('grid-cols-2'),
    'OverviewTab 手机端应使用双列 grid',
    issues,
  )
  assert(
    !/lg:grid-cols-5[\s\S]{0,800}lg:grid-cols-4/.test(src),
    'OverviewTab 不应分两行不同列数的顶部卡片 grid',
    issues,
  )
}

async function main(): Promise<void> {
  const issues: string[] = []
  const results: Array<{ preset: string; orderCount: number; totalGmv: number }> = []

  for (const item of PRESETS) {
    const label =
      item.preset === 'custom'
        ? `custom(${item.startDate}~${item.endDate})`
        : item.preset
    try {
      const res = await executeBoardLocalQuery({
        preset: item.preset,
        startDate: item.startDate,
        endDate: item.endDate,
      })
      const summary = (res.summary ?? {}) as Record<string, unknown>
      validateSummary(summary, label, issues)
      results.push({
        preset: label,
        orderCount: Number(summary.orderCount ?? 0),
        totalGmv: Number(summary.totalGmv ?? 0),
      })
    } catch (err) {
      issues.push(`${label} 查询失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  validateOverviewTabUi(issues)

  console.log('[accept:board-summary-cards] 范围验收结果:')
  for (const row of results) {
    console.log(
      `  - ${row.preset}: orderCount=${row.orderCount}, totalGmv=${row.totalGmv.toFixed(2)}`,
    )
  }
  console.log(`[accept:board-summary-cards] 验收日 ${formatDateKeyShanghai(new Date())}`)

  if (issues.length) {
    console.error('[accept:board-summary-cards] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[accept:board-summary-cards] PASS')
}

void main().catch((err) => {
  console.error('[accept:board-summary-cards] ERROR', err)
  process.exit(1)
})
