/**
 * 月报复盘备注类型验收：monthly 与 weekly/daily 隔离
 *
 * npm run verify:monthly-review-note-type
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import {
  getOpsReviewNote,
  upsertOpsReviewNote,
} from '../src/services/ops-review-note.service'
import { prisma } from '../src/lib/prisma'

config({ path: path.resolve(__dirname, '../.env') })

const TEST_DATE = '2099-01-01'
const WEEKLY_MARKER = 'VERIFY_WEEKLY_NOTE_ONLY'
const MONTHLY_MARKER = 'VERIFY_MONTHLY_NOTE_ONLY'
const DAILY_MARKER = 'VERIFY_DAILY_NOTE_ONLY'

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string): void {
  console.error(`  ✗ FAIL: ${msg}`)
}

async function cleanup(): Promise<void> {
  await prisma.opsReviewNote.deleteMany({
    where: { reportDate: TEST_DATE },
  })
}

async function main(): Promise<void> {
  console.log('verify-monthly-review-note-type\n')
  let failures = 0

  await cleanup()
  await upsertOpsReviewNote({
    reportDate: TEST_DATE,
    reportType: 'daily',
    problemText: DAILY_MARKER,
  })
  await upsertOpsReviewNote({
    reportDate: TEST_DATE,
    reportType: 'weekly',
    problemText: WEEKLY_MARKER,
    mainProducts: ['WEEKLY_MAIN_PRODUCT'],
  })
  await upsertOpsReviewNote({
    reportDate: TEST_DATE,
    reportType: 'monthly',
    problemText: MONTHLY_MARKER,
    mainProducts: ['MONTHLY_MAIN_PRODUCT'],
  })

  console.log('=== 1. 各 reportType 独立存储 ===')
  const daily = await getOpsReviewNote({ reportDate: TEST_DATE, reportType: 'daily' })
  const weekly = await getOpsReviewNote({ reportDate: TEST_DATE, reportType: 'weekly' })
  const monthly = await getOpsReviewNote({ reportDate: TEST_DATE, reportType: 'monthly' })

  if (daily?.problemText !== DAILY_MARKER) {
    fail('daily 备注读取失败')
    failures++
  } else ok('daily 备注独立')
  if (weekly?.problemText !== WEEKLY_MARKER) {
    fail('weekly 备注读取失败')
    failures++
  } else ok('weekly 备注独立')
  if (monthly?.problemText !== MONTHLY_MARKER) {
    fail('monthly 备注读取失败')
    failures++
  } else ok('monthly 备注独立')

  console.log('\n=== 2. 月报不会误读 weekly ===')
  const monthlyLookup = await getOpsReviewNote({
    reportDate: TEST_DATE,
    reportType: 'monthly',
  })
  if (monthlyLookup?.problemText === WEEKLY_MARKER) {
    fail('月报 lookup 误读 weekly 备注')
    failures++
  } else if (monthlyLookup?.mainProducts.includes('WEEKLY_MAIN_PRODUCT')) {
    fail('月报 lookup 误读 weekly mainProducts')
    failures++
  } else if (monthlyLookup?.mainProducts.includes('MONTHLY_MAIN_PRODUCT')) {
    ok('monthly 备注含 MONTHLY_MAIN_PRODUCT，不含 weekly')
  } else {
    fail('monthly mainProducts 异常')
    failures++
  }

  console.log('\n=== 3. 源码 reportType 绑定 ===')
  const monthlySrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/monthly-operations-report.service.ts'),
    'utf8',
  )
  const weeklySrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/weekly-operations-report.service.ts'),
    'utf8',
  )
  const dailySrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/daily-operations-report.service.ts'),
    'utf8',
  )

  if (!monthlySrc.includes("reportType: 'monthly'")) {
    fail('月报 service 未使用 reportType monthly')
    failures++
  } else ok('月报 service 使用 reportType=monthly')
  if (monthlySrc.includes("getOpsReviewNote({") && monthlySrc.includes("reportType: 'weekly'")) {
    fail('月报 service 仍含 reportType weekly')
    failures++
  } else ok('月报 service 不含 weekly 误读')
  if (!weeklySrc.includes("reportType: 'weekly'")) {
    fail('周报 service 未保留 weekly')
    failures++
  } else ok('周报仍使用 weekly')
  if (!dailySrc.includes("reportType: 'daily'")) {
    fail('日报 service 未保留 daily')
    failures++
  } else ok('日报仍使用 daily')

  await cleanup()

  if (failures > 0) {
    console.log(`\nFAIL (${failures} 项)`)
    process.exit(1)
  }
  console.log('\nPASS')
}

main().catch(async (err) => {
  await cleanup().catch(() => {})
  console.error(err)
  process.exit(1)
})
