/**
 * npm run verify:boss-chart-months
 */
import { trimLeadingEmptyMonths } from '../../web/src/lib/boss-chart-months'

const issues: string[] = []
function ok(msg: string) {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string) {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

type Row = { month: string; amountCent: number | null }

function main() {
  console.log('verify-boss-chart-months')

  const sample: Row[] = [
    { month: '2025-08', amountCent: 0 },
    { month: '2025-09', amountCent: 0 },
    { month: '2026-01', amountCent: 0 },
    { month: '2026-02', amountCent: 0 },
    { month: '2026-03', amountCent: 1200000 },
    { month: '2026-04', amountCent: 3500000 },
    { month: '2026-05', amountCent: 0 },
    { month: '2026-06', amountCent: 7000000 },
    { month: '2026-07', amountCent: 1800000 },
  ]

  const trimmed = trimLeadingEmptyMonths(sample, (p) => p.amountCent)
  if (trimmed[0]?.month === '2026-03' && trimmed.length === 5) {
    ok('裁掉开头连续 0 月，从 2026-03 起展示')
  } else {
    fail(`开头裁剪错误：${JSON.stringify(trimmed.map((r) => r.month))}`)
  }

  if (trimmed.some((r) => r.month === '2026-05')) {
    ok('中间 0 月（2026-05）保留')
  } else fail('中间 0 月不应删除')

  const shopLate: Row[] = [
    { month: '2026-03', amountCent: 0 },
    { month: '2026-04', amountCent: 0 },
    { month: '2026-05', amountCent: 0 },
    { month: '2026-06', amountCent: 880000 },
    { month: '2026-07', amountCent: 120000 },
  ]
  const shopTrimmed = trimLeadingEmptyMonths(shopLate, (p) => p.amountCent)
  if (shopTrimmed[0]?.month === '2026-06' && shopTrimmed.length === 2) {
    ok('单店独立从本店首月到账月开始')
  } else fail(`单店裁剪错误：${JSON.stringify(shopTrimmed.map((r) => r.month))}`)

  const allZero = trimLeadingEmptyMonths(
    [
      { month: '2026-01', amountCent: 0 },
      { month: '2026-02', amountCent: 0 },
    ],
    (p) => p.amountCent,
  )
  if (allZero.length === 0) ok('全 0 返回空数组')
  else fail('全 0 应显示空状态')

  const nullLeading = trimLeadingEmptyMonths(
    [
      { month: '2026-01', amountCent: null },
      { month: '2026-02', amountCent: 0 },
      { month: '2026-03', amountCent: 50000 },
    ],
    (p) => p.amountCent,
  )
  if (nullLeading[0]?.month === '2026-03') ok('null 不计为首月有数据，仅裁开头')
  else fail(`null Leading 裁剪错误：${JSON.stringify(nullLeading)}`)

  const over12: Row[] = [
    '2024-01',
    '2024-02',
    '2024-03',
    '2024-04',
    '2024-05',
    '2024-06',
    '2024-07',
    '2024-08',
    '2024-09',
    '2024-10',
    '2024-11',
    '2024-12',
    '2025-01',
  ].map((month, idx) => ({ month, amountCent: idx < 10 ? 0 : 100000 }))
  const capped = trimLeadingEmptyMonths(over12, (p) => p.amountCent, 12)
  if (capped.length === 3 && capped[0]?.month === '2024-11') {
    ok('超过 12 个月时先限 12 再裁开头 0')
  } else {
    fail(`12 月上限裁剪错误：${JSON.stringify(capped.map((r) => r.month))}`)
  }

  if (issues.length === 0) {
    console.log('\nALL PASS')
    process.exit(0)
  }
  console.log(`\nFAILED: ${issues.length}`)
  process.exit(1)
}

main()
