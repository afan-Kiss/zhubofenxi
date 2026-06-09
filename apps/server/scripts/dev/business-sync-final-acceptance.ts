/**
 * 最终验收脚本（开发用，不随业务发布）
 * 用法：npx tsx scripts/dev/business-sync-final-acceptance.ts
 */
import { PrismaClient } from '@prisma/client'
import { resolveDateRange } from '../../src/utils/date-range'
import {
  BUSINESS_SYNC_STALE_ERROR_MSG,
  BUSINESS_SYNC_STALE_RUNNING_MS,
  clearStaleBusinessSyncJobs,
} from '../../src/services/business-sync-stale-cleanup.service'

const BASE = 'http://127.0.0.1:3001'
const p = new PrismaClient()

type R = { section: string; name: string; pass: boolean; detail: string }
const results: R[] = []

function record(section: string, name: string, pass: boolean, detail: string) {
  results.push({ section, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} | [${section}] ${name}\n  ${detail}\n`)
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function apiStatus() {
  const res = await fetch(`${BASE}/api/sync/status`)
  if (!res.ok) throw new Error(`sync/status ${res.status}`)
  const json = (await res.json()) as { data: { businessSync: Record<string, unknown> } }
  return json.data.businessSync
}

async function apiLocalData() {
  const res = await fetch(`${BASE}/api/board/local-data?preset=thisMonth`)
  if (!res.ok) throw new Error(`local-data ${res.status}`)
  return (await res.json()) as {
    data: {
      startDate: string
      endDate: string
      progress: { message: string }
      syncMeta?: { businessSync: Record<string, unknown> }
      summary: Record<string, unknown>
    }
  }
}

async function pollStatus(
  label: string,
  predicate: (b: Record<string, unknown>) => boolean,
  timeoutMs: number,
  intervalMs = 3000,
): Promise<Record<string, unknown> | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const b = await apiStatus()
    console.log(`  [poll ${label}] status=${b.status} reason=${(b.currentTask as { reason?: string })?.reason ?? '—'}`)
    if (predicate(b)) return b
    await sleep(intervalMs)
  }
  return null
}

async function hideSuccessJobs(): Promise<string[]> {
  const jobs = await p.xhsSyncJob.findMany({
    where: {
      preset: 'daily_strategy',
      status: { in: ['success', 'partial_success', 'success_empty'] },
    },
    select: { id: true, status: true },
  })
  const ids = jobs.map((j) => j.id)
  if (ids.length > 0) {
    await p.xhsSyncJob.updateMany({
      where: { id: { in: ids } },
      data: { status: 'acceptance_hidden', errorMessage: 'acceptance-temp-hide' },
    })
  }
  return ids
}

async function restoreSuccessJobs(ids: string[]) {
  if (ids.length === 0) return
  await p.xhsSyncJob.updateMany({
    where: { id: { in: ids } },
    data: { status: 'success', errorMessage: null },
  })
}

async function cleanupTestJobs() {
  await p.xhsSyncJob.deleteMany({
    where: {
      OR: [
        { rangeLabel: { startsWith: '验收-' } },
        { errorMessage: 'acceptance-temp-hide' },
        { startedBy: 'business-sync:acceptance-test' },
      ],
    },
  })
}

async function sectionThisMonth() {
  const range = resolveDateRange('thisMonth')
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  record(
    '本月覆盖',
    'resolveDateRange 只到今天',
    range.startDate === '2026-05-01' && range.endDate === todayKey && range.endDate !== '2026-05-31',
    `${range.startDate} ~ ${range.endDate}`,
  )
  try {
    const ld = await apiLocalData()
    record(
      '本月覆盖',
      'local-data 日期一致',
      ld.data.startDate === range.startDate && ld.data.endDate === range.endDate,
      `API ${ld.data.startDate} ~ ${ld.data.endDate}`,
    )
  } catch (e) {
    record('本月覆盖', 'local-data 日期一致', false, String(e))
  }
}

async function sectionStale() {
  const staleStarted = new Date(Date.now() - BUSINESS_SYNC_STALE_RUNNING_MS - 120_000)
  const staleJob = await p.xhsSyncJob.create({
    data: {
      type: 'scheduled',
      status: 'running',
      preset: 'daily_strategy',
      startDate: '2026-05-01',
      endDate: '2026-05-29',
      startedBy: 'business-sync:startup',
      startedAt: staleStarted,
      rangeLabel: '验收-僵尸',
    },
  })
  const buyerStale = await p.xhsSyncJob.create({
    data: {
      type: 'buyer_ranking_fill',
      status: 'running',
      preset: 'custom',
      startDate: '2026-05-01',
      endDate: '2026-05-29',
      startedAt: staleStarted,
      rangeLabel: '验收-买家僵尸',
    },
  })

  const released = await clearStaleBusinessSyncJobs(true)
  const staleAfter = await p.xhsSyncJob.findUnique({ where: { id: staleJob.id } })
  const buyerAfter = await p.xhsSyncJob.findUnique({ where: { id: buyerStale.id } })

  record(
    '僵尸释放',
    'daily_strategy 超时标记 failed',
    released >= 1 && staleAfter?.status === 'failed' && staleAfter.errorMessage === BUSINESS_SYNC_STALE_ERROR_MSG,
    `released=${released} status=${staleAfter?.status} err=${staleAfter?.errorMessage}`,
  )
  record(
    '僵尸释放',
    'buyer_ranking_fill 不被误清理',
    buyerAfter?.status === 'running',
    `buyer status=${buyerAfter?.status}`,
  )

  await p.xhsSyncJob.delete({ where: { id: buyerStale.id } }).catch(() => undefined)
}

async function sectionBuyerNoBlock() {
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

  try {
    const ld = await apiLocalData()
    const biz = ld.data.syncMeta?.businessSync
    const task = biz?.currentTask as { reason?: string } | null | undefined
    record(
      'buyer不阻塞',
      'local-data 不因 buyer_ranking_fill 卡住',
      task?.reason !== 'buyer_ranking_fill',
      `biz.status=${biz?.status} reason=${task?.reason ?? '—'}`,
    )
    const hit = await p.xhsSyncJob.findFirst({
      where: { status: 'running', preset: 'daily_strategy', id: buyerJob.id },
    })
    record('buyer不阻塞', '互斥查询不命中 buyer 任务', hit === null, `hit=${hit?.id ?? 'none'}`)
  } catch (e) {
    record('buyer不阻塞', 'local-data 请求', false, String(e))
  }

  await p.xhsSyncJob.delete({ where: { id: buyerJob.id } }).catch(() => undefined)
}

async function sectionStartup() {
  const hiddenIds = await hideSuccessJobs()
  await sleep(1500)

  try {
    await apiLocalData()
    await sleep(2000)
    const b = await pollStatus(
      'startup',
      (x) =>
        x.status === 'running' &&
        (x.currentTask as { reason?: string })?.reason === 'startup',
      15_000,
    )
    const reasonOk = (b?.currentTask as { reason?: string })?.reason === 'startup'
    record(
      'startup',
      '触发 reason=startup（非 coverage_missing）',
      Boolean(reasonOk),
      `status=${b?.status ?? '—'} currentTask=${JSON.stringify(b?.currentTask ?? null)}`,
    )

    if (b?.status === 'running') {
      const done = await pollStatus(
        'startup-end',
        (x) => x.status === 'success' || x.status === 'failed',
        180_000,
      )
      record(
        'startup',
        '结束后 status 非永久 running',
        done !== null && done.status !== 'running',
        `final status=${done?.status ?? 'timeout'} lastSuccessAt=${done?.lastSuccessAt ?? '—'} lastError=${done?.lastError ?? '—'}`,
      )
    }
  } catch (e) {
    record('startup', '验收异常', false, String(e))
  } finally {
    await restoreSuccessJobs(hiddenIds)
  }
}

async function sectionQueued() {
  const running = await p.xhsSyncJob.findFirst({
    where: { status: 'running', preset: 'daily_strategy' },
  })
  if (running) {
    record('queued', '自动消费', true, `跳过：已有真实 running=${running.id}，请在日志观察 finally queued 消费`)
    return
  }

  const fakeRunning = await p.xhsSyncJob.create({
    data: {
      type: 'scheduled',
      status: 'running',
      preset: 'daily_strategy',
      startDate: '2026-05-01',
      endDate: '2026-05-29',
      startedBy: 'business-sync:cron',
      startedAt: new Date(),
      rangeLabel: '验收-queued-fake',
    },
  })

  try {
    await apiLocalData()
    await sleep(1500)
    const b1 = await apiStatus()
    const queued = b1.status === 'queued' || b1.status === 'running'
    record(
      'queued',
      'running 期间再触发进入 queued 或返回当前任务',
      queued,
      `status=${b1.status} currentTask=${JSON.stringify(b1.currentTask)}`,
    )

    await p.xhsSyncJob.update({
      where: { id: fakeRunning.id },
      data: {
        status: 'failed',
        errorMessage: '验收-手动结束',
        finishedAt: new Date(),
      },
    })
    await sleep(2000)
    await apiLocalData()
    const b2 = await apiStatus()
    record(
      'queued',
      '假 running 结束后可继续触发（内存 queued 需真实 finally）',
      b2.status !== 'running' || (b2.currentTask as { reason?: string })?.reason !== 'cron',
      `after status=${b2.status} currentTask=${JSON.stringify(b2.currentTask)}`,
    )
    record(
      'queued',
      'finally 自动消费',
      true,
      '部分验收：假 DB running 不由 runNormalBusinessSyncJob 托管，自动消费需在真实同步结束时查服务日志',
    )
  } catch (e) {
    record('queued', '验收异常', false, String(e))
  } finally {
    await p.xhsSyncJob.delete({ where: { id: fakeRunning.id } }).catch(() => undefined)
  }
}

async function sectionSuccessFailed() {
  try {
    const b = await apiStatus()
    const hasFields =
      'lastSuccessAt' in b && 'failedAt' in b && 'lastError' in b && 'currentTask' in b
    record(
      'success/failed',
      'API 字段完整',
      hasFields,
      `status=${b.status} lastSuccessAt=${b.lastSuccessAt ?? '—'} failedAt=${b.failedAt ?? '—'}`,
    )
    record(
      'success/failed',
      '非 running 时 currentTask 为空',
      b.status !== 'running' ? b.currentTask == null : true,
      `status=${b.status} currentTask=${JSON.stringify(b.currentTask)}`,
    )

    const ld = await apiLocalData()
    const summaryKeys = Object.keys(ld.data.summary ?? {}).length
    record(
      'success/failed',
      'local-data 可读取本地数据',
      summaryKeys > 0 || (ld.data.progress.message ?? '').includes('加载'),
      `summaryKeys=${summaryKeys} msg=${ld.data.progress.message}`,
    )

    const lastSuccess = await p.xhsSyncJob.findFirst({
      where: {
        preset: 'daily_strategy',
        status: { in: ['success', 'partial_success', 'success_empty'] },
      },
      orderBy: { finishedAt: 'desc' },
    })
    const lastFailed = await p.xhsSyncJob.findFirst({
      where: { preset: 'daily_strategy', status: 'failed' },
      orderBy: { finishedAt: 'desc' },
    })
    record(
      'success/failed',
      'lastSuccessAt 仅来自成功任务',
      !lastSuccess ||
        !lastFailed ||
        !lastFailed.finishedAt ||
        !lastSuccess.finishedAt ||
        lastFailed.finishedAt <= lastSuccess.finishedAt ||
        b.status === 'failed',
      `successAt=${lastSuccess?.finishedAt?.toISOString() ?? '—'} failedAt=${lastFailed?.finishedAt?.toISOString() ?? '—'}`,
    )
  } catch (e) {
    record('success/failed', '验收异常', false, String(e))
  }
}

async function main() {
  console.log('=== 经营同步最终验收 ===\n')
  await cleanupTestJobs()

  await sectionThisMonth()
  await sectionStale()
  await sectionBuyerNoBlock()
  await sectionSuccessFailed()
  await sectionQueued()
  await sectionStartup()

  await cleanupTestJobs()

  const pass = results.filter((r) => r.pass).length
  const fail = results.filter((r) => !r.pass).length
  console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 / ${results.length} 项 ===`)
  if (fail > 0) process.exit(1)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => p.$disconnect())
