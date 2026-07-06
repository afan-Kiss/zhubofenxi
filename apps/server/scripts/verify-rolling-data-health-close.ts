/**
 * 滚动 30 天数据健康结账验收
 *
 * npm run verify:rolling-data-health-close
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import {
  resolveRollingDataHealthCloseRange,
  buildRollingDataHealthCloseReport,
} from '../src/services/rolling-data-health-close.service'
import { addDaysShanghai } from '../src/utils/business-timezone'

config({ path: path.resolve(__dirname, '../.env') })

const ROOT = path.resolve(__dirname, '../..')
const issues: string[] = []

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf-8')
}

async function main(): Promise<void> {
  console.log('verify-rolling-data-health-close\n')

  const service = read('server/src/services/rolling-data-health-close.service.ts')
  const store = read('server/src/services/rolling-data-health-close-store.service.ts')
  const scheduler = read('server/src/services/scheduler.service.ts')
  const syncMeta = read('server/src/services/board-sync-meta.service.ts')
  const routes = read('server/src/routes/board.routes.ts')
  const panel = read('web/src/components/board/DataHealthPanel.tsx')

  const sample = resolveRollingDataHealthCloseRange('2026-07-06')
  const expectedEnd = addDaysShanghai('2026-07-06', -15)
  const expectedStart = addDaysShanghai(expectedEnd, -29)

  if (sample.endDate === expectedEnd) {
    ok(`endDate = 当前上海日期 - 15 天 (${sample.endDate})`)
  } else {
    fail(`endDate 期望 ${expectedEnd}，实际 ${sample.endDate}`)
  }

  if (sample.startDate === expectedStart) {
    ok(`startDate = endDate - 29 天 (${sample.startDate})`)
  } else {
    fail(`startDate 期望 ${expectedStart}，实际 ${sample.startDate}`)
  }

  if (sample.dayCount === 30) {
    ok('范围刚好 30 天')
  } else {
    fail(`范围天数应为 30，实际 ${sample.dayCount}`)
  }

  if (!service.includes('resolveMonthlyCloseMonth') && !service.includes('resolveAutoCloseTargetMonth')) {
    ok('滚动结账未使用自然月 resolveMonthlyCloseMonth / resolveAutoCloseTargetMonth')
  } else {
    fail('滚动结账误用自然月范围函数')
  }

  if (service.includes('calculateBusinessMetrics')) {
    ok('runRollingDataHealthClose 使用 calculateBusinessMetrics')
  } else {
    fail('未使用 calculateBusinessMetrics')
  }

  for (const field of [
    'gmvAmountYuan',
    'actualSignedAmountYuan',
    'refundAmountYuan',
    'paidOrderCount',
    'signedOrderCount',
    'refundOrderCount',
    'signRate',
    'refundRate',
    'qualityRefundOrderCount',
  ]) {
    if (store.includes(field)) ok(`报告包含 ${field}`)
    else fail(`报告缺少 ${field}`)
  }

  if (
    scheduler.includes('runRollingDataHealthClose') &&
    scheduler.includes("triggeredBy: 'buyer-ranking-scheduler'")
  ) {
    ok('买家排行榜 03:00 任务会触发 runRollingDataHealthClose')
  } else {
    fail('scheduler 未触发 runRollingDataHealthClose')
  }

  if (scheduler.includes('finally') && scheduler.includes('runRollingDataHealthClose')) {
    ok('买家排行榜失败时 rolling close 仍在 finally 尝试执行')
  } else {
    fail('scheduler 未在 finally 中执行 rolling close')
  }

  if (syncMeta.includes('rollingDataHealthClose')) {
    ok('board-sync-meta 返回 rollingDataHealthClose')
  } else {
    fail('board-sync-meta 未返回 rollingDataHealthClose')
  }

  if (panel.includes('滚动30天结账')) {
    ok('DataHealthPanel 显示「滚动30天结账」')
  } else {
    fail('DataHealthPanel 未显示滚动30天结账')
  }

  if (routes.includes('/data-health/rolling-close/run') && routes.includes('/data-health/rolling-close/latest')) {
    ok('手动触发与只读接口已注册')
  } else {
    fail('滚动结账 API 未注册')
  }

  const monthlyScheduler = read('server/src/services/monthly-close-scheduler.service.ts')
  if (monthlyScheduler.includes('runMonthlyCloseAuto')) {
    ok('保留老 monthly-close-scheduler 每月逻辑')
  } else {
    fail('monthly-close-scheduler 逻辑缺失')
  }

  console.log('\n=== 运行时冒烟 ===')
  try {
    const report = await buildRollingDataHealthCloseReport({ triggeredBy: 'verify-script' })
    ok(
      `buildRollingDataHealthCloseReport OK: ${report.startDate}~${report.endDate} GMV=${report.gmvAmountYuan}`,
    )
  } catch (err) {
    fail(`buildRollingDataHealthCloseReport 失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  console.log('\n=== 结果 ===')
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(` - ${i}`)
    process.exit(1)
  }
  console.log('PASS')
}

void main()
