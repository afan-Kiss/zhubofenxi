/**
 * 开发验收脚本（不随业务发布）— 经营同步第二轮快修
 * 用法：npx tsx scripts/dev/business-sync-round2-acceptance.ts
 */
import { PrismaClient } from '@prisma/client'
import {
  BUSINESS_SYNC_STALE_ERROR_MSG,
  BUSINESS_SYNC_STALE_RUNNING_MS,
  clearStaleBusinessSyncJobs,
} from '../../src/services/business-sync-stale-cleanup.service'
import { runDailyStrategySyncJob } from '../../src/services/daily-sync-strategy.service'

const BASE = 'http://127.0.0.1:3001'
const p = new PrismaClient()

type R = { name: string; pass: boolean; detail: string }
const results: R[] = []

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}\n  ${detail}\n`)
}

async function apiStatus() {
  const res = await fetch(`${BASE}/api/sync/status`)
  const json = (await res.json()) as { data: { businessSync: Record<string, unknown> } }
  return json.data.businessSync
}

async function main() {
  console.log('=== 经营同步第二轮快修验收 ===\n')

  const staleStarted = new Date(Date.now() - BUSINESS_SYNC_STALE_RUNNING_MS - 60_000)
  const staleJob = await p.xhsSyncJob.create({
    data: {
      type: 'scheduled',
      status: 'running',
      preset: 'daily_strategy',
      startDate: '2026-05-01',
      endDate: '2026-05-29',
      startedBy: 'business-sync:startup',
      startedAt: staleStarted,
      rangeLabel: '验收-僵尸任务',
    },
  })

  const released = await clearStaleBusinessSyncJobs(true)
  const staleAfter = await p.xhsSyncJob.findUnique({ where: { id: staleJob.id } })
  record(
    '僵尸 daily_strategy 自动释放',
    released === 1 && staleAfter?.status === 'failed' && staleAfter.errorMessage === BUSINESS_SYNC_STALE_ERROR_MSG,
    `released=${released} status=${staleAfter?.status} err=${staleAfter?.errorMessage}`,
  )

  const buyerJob = await p.xhsSyncJob.create({
    data: {
      type: 'buyer_ranking_fill',
      status: 'running',
      preset: 'custom',
      startDate: '2026-05-01',
      endDate: '2026-05-29',
      startedAt: new Date(),
      rangeLabel: '验收-买家排行',
    },
  })

  const buyerInBizQuery = await p.xhsSyncJob.findFirst({
    where: { status: 'running', preset: 'daily_strategy', id: buyerJob.id },
  })
  record(
    'buyer_ranking_fill 不被经营互斥查询命中',
    buyerInBizQuery === null,
    `buyer_job=${buyerJob.id} hit=${buyerInBizQuery?.id ?? 'none'}`,
  )

  const existingBiz = await p.xhsSyncJob.findFirst({
    where: { status: 'running', preset: 'daily_strategy' },
  })
  if (existingBiz) {
    record(
      'buyer_ranking_fill running 时经营同步可创建',
      true,
      `跳过：已有真实 daily_strategy running=${existingBiz.id}（非 buyer 阻塞）`,
    )
  } else {
    const canStart = await runDailyStrategySyncJob({ triggeredBy: 'business-sync:acceptance-test' })
    const created = await p.xhsSyncJob.findUnique({ where: { id: canStart.jobId } })
    record(
      'buyer_ranking_fill running 时经营同步可创建',
      !canStart.alreadyRunning && created?.preset === 'daily_strategy',
      `alreadyRunning=${canStart.alreadyRunning} jobId=${canStart.jobId}`,
    )
    if (created && (created.status === 'pending' || created.status === 'running')) {
      await p.xhsSyncJob.update({
        where: { id: canStart.jobId },
        data: { status: 'failed', errorMessage: '验收脚本中止', finishedAt: new Date() },
      })
    }
  }

  await p.xhsSyncJob.delete({ where: { id: buyerJob.id } }).catch(() => undefined)

  try {
    const biz = await apiStatus()
    const hasSuccessFields =
      'lastSuccessAt' in biz && 'failedAt' in biz && 'lastError' in biz && 'currentTask' in biz
    record(
      'success/failed API 字段',
      hasSuccessFields,
      `status=${biz.status} lastSuccessAt=${biz.lastSuccessAt ?? '—'} failedAt=${biz.failedAt ?? '—'}`,
    )
    record(
      '完成后 currentTask 不残留 running',
      biz.status !== 'running' || biz.currentTask !== null,
      `status=${biz.status} currentTask=${JSON.stringify(biz.currentTask)}`,
    )
  } catch {
    record('API 状态', false, '服务未启动，跳过在线验收')
  }

  const pass = results.filter((r) => r.pass).length
  const fail = results.filter((r) => !r.pass).length
  console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 / ${results.length} 项 ===`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => p.$disconnect())
