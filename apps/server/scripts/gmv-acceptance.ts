/**
 * GMV 金额口径验收：同步（可选）→ live-query → 三处 GMV 对齐校验
 *
 * 用法:
 *   npm run accept:gmv          # 根目录：尝试同步（已有任务最多等 60s）
 *   npm run accept:gmv:fast     # 跳过同步，保留/使用当前快照与库内数据验收
 *   GMV_ACCEPT_PRESET=custom GMV_ACCEPT_START=2026-05-28 GMV_ACCEPT_END=2026-05-28 npm run accept:gmv
 */
import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { refreshAnchorConfigCache } from '../src/services/anchor.service'
import { resolveDateRange, type DateRangePreset } from '../src/utils/date-range'
import { buildGmvDiagnostics } from '../src/services/gmv-diagnostic.service'
import { executeBoardLiveQuery } from '../src/services/board-live-query.service'
import {
  buildRawAnalyzeBundle,
  runAnalysisPipelineFromXhsRaw,
} from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { runXhsSyncJob } from '../src/services/xhs-api-sync/xhs-sync-job.service'
import {
  prepareAnalysisArtifactsFromRaw,
  runBusinessAnalysisFromRaw,
} from '../src/services/business-analysis.service'
import { computeGrossProfitBreakdown } from '../src/services/gross-profit.service'
import { centToYuan } from '../src/utils/money'
import { formatDateKey } from '../src/utils/date-range'

config({ path: path.resolve(__dirname, '../.env') })

const prisma = new PrismaClient()

const TARGET_GMV_CENT = 500_890
const TARGET_GMV_YUAN = 5008.9

/** 等待「已在运行」的同步任务，超过则不再死等 */
const WAIT_EXISTING_SYNC_MS = 60_000
/** 本脚本新发起的同步任务最长等待 */
const WAIT_NEW_SYNC_MS = 600_000
const SYNC_LOG_INTERVAL_MS = 5_000
const SYNC_POLL_MS = 2_000

const TERMINAL_SYNC_STATUSES = [
  'success',
  'partial_success',
  'failed',
  'skipped',
  'success_empty',
] as const

const EXPECTED_ORDERS = [
  { packageId: 'P795490183646098221', gmvCent: 298_000 },
  { packageId: 'P795488136122205841', gmvCent: 199_900 },
  { packageId: 'P795487315710005941', gmvCent: 2_990 },
] as const

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

async function discoverTargetRange(): Promise<{
  preset: DateRangePreset
  startDate: string
  endDate: string
}> {
  const envPreset = process.env.GMV_ACCEPT_PRESET?.trim() as DateRangePreset | undefined
  const envStart = process.env.GMV_ACCEPT_START?.trim()
  const envEnd = process.env.GMV_ACCEPT_END?.trim()
  if (envPreset === 'custom' && envStart && envEnd) {
    return { preset: 'custom', startDate: envStart, endDate: envEnd }
  }
  if (envPreset && envPreset !== 'custom') {
    const r = resolveDateRange(envPreset)
    return { preset: envPreset, startDate: r.startDate, endDate: r.endDate }
  }

  for (const exp of EXPECTED_ORDERS) {
    const row = await prisma.xhsRawOrder.findFirst({
      where: { packageId: exp.packageId },
    })
    if (row?.orderTime) {
      const day = formatDateKey(row.orderTime)
      return { preset: 'custom', startDate: day, endDate: day }
    }
  }

  const r = resolveDateRange('today')
  return { preset: 'today', startDate: r.startDate, endDate: r.endDate }
}

async function clearSnapshots(_startDate: string, _endDate: string): Promise<number> {
  return 0
}

type SyncWaitOutcome = 'completed' | 'timeout' | 'failed'

async function waitForSyncJob(
  jobId: string,
  timeoutMs: number,
  label: string,
): Promise<SyncWaitOutcome> {
  const started = Date.now()
  let lastLogAt = 0

  const logStatus = (job: {
    status: string
    currentStepLabel: string
    progress: number
    currentStep: string
  }): void => {
    const elapsedSec = Math.floor((Date.now() - started) / 1000)
    const limitSec = Math.floor(timeoutMs / 1000)
    console.log(
      `[等待同步·${label}] 已等待 ${elapsedSec}s / 最多 ${limitSec}s | job=${jobId} | status=${job.status} | ${job.currentStepLabel} (${job.progress}%)`,
    )
  }

  while (Date.now() - started < timeoutMs) {
    const job = await prisma.xhsSyncJob.findUnique({ where: { id: jobId } })
    if (!job) throw new Error(`同步任务不存在: ${jobId}`)

    const elapsed = Date.now() - started
    if (elapsed - lastLogAt >= SYNC_LOG_INTERVAL_MS || lastLogAt === 0) {
      logStatus(job)
      lastLogAt = elapsed
    }

    if (TERMINAL_SYNC_STATUSES.includes(job.status as (typeof TERMINAL_SYNC_STATUSES)[number])) {
      if (job.status === 'failed') {
        console.warn(`[等待同步·${label}] 同步失败: ${job.errorMessage ?? '未知原因'}`)
        return 'failed'
      }
      console.log(`[等待同步·${label}] 同步已结束 status=${job.status}`)
      return 'completed'
    }

    await new Promise((r) => setTimeout(r, SYNC_POLL_MS))
  }

  const job = await prisma.xhsSyncJob.findUnique({ where: { id: jobId } })
  console.warn(
    `[等待同步·${label}] 已达 ${Math.floor(timeoutMs / 1000)}s 上限，不再等待（当前 status=${job?.status ?? 'unknown'}）`,
  )
  return 'timeout'
}

async function tryApiSync(
  target: { preset: DateRangePreset; startDate: string; endDate: string },
): Promise<string> {
  const { job, alreadyRunning } = await runXhsSyncJob({
    type: 'manual',
    preset: target.preset,
    startDate: target.preset === 'custom' ? target.startDate : undefined,
    endDate: target.preset === 'custom' ? target.endDate : undefined,
  })
  const syncJobId = job.syncJobId
  if (!syncJobId) throw new Error('同步任务 ID 为空')

  const waitMs = alreadyRunning ? WAIT_EXISTING_SYNC_MS : WAIT_NEW_SYNC_MS
  const label = alreadyRunning ? '已有任务' : '新任务'

  if (alreadyRunning) {
    console.log(`检测到同步任务进行中: ${syncJobId}，最多等待 ${waitMs / 1000} 秒…`)
  } else {
    console.log(`已启动 API 同步: ${syncJobId}，最多等待 ${waitMs / 1000} 秒…`)
  }

  const outcome = await waitForSyncJob(syncJobId, waitMs, label)
  const finished = await prisma.xhsSyncJob.findUnique({ where: { id: syncJobId } })

  if (outcome === 'completed') {
    return `API 同步完成 status=${finished?.status} orders=${finished?.orderCount ?? 0}`
  }
  if (outcome === 'timeout') {
    return `等待同步超时(${waitMs / 1000}s)，沿用数据库现有数据（进行中 job=${syncJobId} status=${finished?.status}）`
  }
  return `同步失败: ${finished?.errorMessage ?? '未知'}，沿用数据库现有数据`
}

async function runLiveQueryForAcceptance(
  preset: DateRangePreset,
  startDate: string,
  endDate: string,
): Promise<Awaited<ReturnType<typeof executeBoardLiveQuery>>> {
  return executeBoardLiveQuery({
    preset: preset as import('../src/services/board-live-query.service').BoardLiveQueryPreset,
    startDate: preset === 'custom' ? startDate : undefined,
    endDate: preset === 'custom' ? endDate : undefined,
    pageSize: 5000,
  })
}

function printSection(title: string): void {
  console.log('\n' + '='.repeat(60))
  console.log(title)
  console.log('='.repeat(60))
}

async function exportGmvDiff(
  preset: DateRangePreset,
  startDate: string,
  endDate: string,
  actualGmvCent: number,
): Promise<void> {
  printSection('GMV 差异明细（未改公式，仅导出）')
  const range = resolveDateRange(
    preset,
    preset === 'custom' ? startDate : undefined,
    preset === 'custom' ? endDate : undefined,
  )
  const bundle = await buildRawAnalyzeBundle(range)
  if (!bundle) {
    console.log('无原始 bundle')
    return
  }

  const valid = bundle.orders.filter((o) => o.errors.length === 0)
  const byMatch = new Map<string, (typeof valid)[0]>()
  for (const o of valid) {
    const id = o.matchOrderId || o.packageId || o.orderId
    if (id) byMatch.set(id, o)
  }

  const expectedIds = new Set(EXPECTED_ORDERS.map((e) => e.packageId))
  const actualIds = new Set(byMatch.keys())

  console.log(`目标 GMV: ${TARGET_GMV_YUAN} 元 (${TARGET_GMV_CENT} 分)`)
  console.log(`实际 GMV 合计: ${centToYuan(actualGmvCent)} 元 (${actualGmvCent} 分)`)
  console.log(`差额: ${centToYuan(actualGmvCent - TARGET_GMV_CENT)} 元`)

  console.log('\n--- 少算（期望有、实际无或金额为 0）---')
  for (const exp of EXPECTED_ORDERS) {
    const o = byMatch.get(exp.packageId)
    if (!o) {
      console.log(`  [缺失] ${exp.packageId} 期望 ${centToYuan(exp.gmvCent)} 元`)
      continue
    }
    if (o.gmvCent !== exp.gmvCent) {
      console.log(
        `  [金额偏低/偏高] ${exp.packageId} 期望 ${exp.gmvCent} 分，实际 ${o.gmvCent} 分，来源=${o.gmvSourceUsed}`,
      )
    }
  }

  console.log('\n--- 多算（实际有、不在期望三单内）---')
  for (const [id, o] of byMatch) {
    if (!expectedIds.has(id)) {
      console.log(
        `  [额外] matchOrderId=${id} packageId=${o.packageId} bizOrderId=${o.bizOrderId} GMV=${o.gmvCent} 分 应收=${o.receivableAmountCent} 来源=${o.gmvSourceUsed}`,
      )
    }
  }

  console.log('\n--- 金额字段可能取错（GMV≠期望且应收与 GMV 不同）---')
  for (const exp of EXPECTED_ORDERS) {
    const o = byMatch.get(exp.packageId)
    if (!o) continue
    if (o.gmvCent !== exp.gmvCent) {
      console.log(
        `  ${exp.packageId}: gmv=${o.gmvCent} receivable=${o.receivableAmountCent} productAmount=${o.productAmountCent} source=${o.gmvSourceUsed} warnings=${o.amountWarnings.join(';') || '—'}`,
      )
      if (o.receivableAmountCent === o.gmvCent && o.gmvCent !== exp.gmvCent) {
        console.log('    → 可能仍在使用应收口径')
      }
    }
  }

  console.log('\n--- packageId / bizOrderId / matchOrderId 异常 ---')
  for (const o of valid) {
    const issues: string[] = []
    if (!o.packageId && !o.bizOrderId) issues.push('无包裹号与业务单号')
    if (!o.matchOrderId) issues.push('matchOrderId 为空')
    if (o.packageId && o.bizOrderId && o.matchOrderId !== o.packageId && o.matchOrderId !== o.bizOrderId) {
      issues.push(`matchOrderId=${o.matchOrderId} 与 package/biz 不一致`)
    }
    if (issues.length > 0) {
      console.log(
        `  orderId=${o.orderId} package=${o.packageId} biz=${o.bizOrderId} match=${o.matchOrderId}: ${issues.join('；')}`,
      )
    }
  }

  console.log('\n--- 范围内全部有效订单 GMV 列表 ---')
  for (const o of valid.sort((a, b) => b.gmvCent - a.gmvCent)) {
    console.log(
      `  ${o.matchOrderId} | GMV ${centToYuan(o.gmvCent)} | 应收 ${centToYuan(o.receivableAmountCent)} | signed=${o.isSigned} returned=${o.isReturned} | ${o.gmvSourceUsed}`,
    )
  }

  void actualIds
}

async function main(): Promise<void> {
  printSection('GMV 金额口径验收')
  await refreshAnchorConfigCache()

  const target = await discoverTargetRange()
  const range = resolveDateRange(
    target.preset,
    target.preset === 'custom' ? target.startDate : undefined,
    target.preset === 'custom' ? target.endDate : undefined,
  )

  console.log(`目标日期范围: ${range.startDate} ~ ${range.endDate} (preset=${target.preset})`)

  const skipSync = envFlag('GMV_ACCEPT_SKIP_SYNC')
  let syncNote = skipSync ? '快速模式：未执行 API 同步' : '未执行 API 同步'

  if (skipSync) {
    console.log('GMV_ACCEPT_SKIP_SYNC=1：跳过同步与等待，使用当前数据库数据验收')
  } else {
    const deleted = await clearSnapshots(range.startDate, range.endDate)
    console.log(`已清理快照: ${deleted} 条`)
    try {
      syncNote = await tryApiSync(target)
      console.log(syncNote)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`API 同步异常，将仅用本地原始数据: ${msg}`)
      syncNote = `同步异常: ${msg}`
    }
  }

  if (skipSync) {
    console.log('快速模式：跳过 API 同步，仍执行 live-query 拉数')
  }

  console.log('执行 live-query 实时统计…')
  const live = await runLiveQueryForAcceptance(target.preset, target.startDate, target.endDate)
  console.log(
    `live-query 完成 requestId=${live.requestId} source=${live.source} orders=${live.summary.orderCount}`,
  )

  const bundle = await buildRawAnalyzeBundle(range)
  const rawOrderCount = bundle?.orders.length ?? 0
  const rawValidCount = bundle?.orders.filter((o) => o.errors.length === 0).length ?? 0

  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const dedupedCount = artifacts?.dedupe.uniqueOrders.length ?? 0
  const biGmvCent = artifacts
    ? artifacts.views.reduce((s, v) => s + v.effectiveGmvCent, 0)
    : 0

  const diag = await buildGmvDiagnostics(
    target.preset,
    target.preset === 'custom' ? target.startDate : undefined,
    target.preset === 'custom' ? target.endDate : undefined,
  )

  const pipeline = bundle ? runBusinessAnalysisFromRaw(bundle) : null
  const overview = pipeline?.overview

  const orderIds = new Set(
    (artifacts?.dedupe.uniqueOrders ?? []).map((o) => o.matchOrderId),
  )
  const gp = computeGrossProfitBreakdown(
    orderIds,
    diag.sumOrderGmvCent,
    artifacts?.settlement,
  )

  const homeGmvCent = Math.round(Number(live.summary.totalGmv ?? live.summary.gmv ?? 0) * 100)
  const diagGmvCent = diag.sumOrderGmvCent
  const dashDiagCent = diag.dashboardGmvCent

  printSection('验收指标')
  console.log(JSON.stringify({
    dateRange: { start: range.startDate, end: range.endDate, preset: target.preset },
    mode: skipSync ? 'fast' : 'full',
    syncNote,
    requestId: live.requestId,
    source: live.source,
    isFromCache: live.isFromCache,
    orderNos: live.debug.orderNos,
    rawOrderRows: rawOrderCount,
    rawValidRows: rawValidCount,
    dedupedOrderCount: dedupedCount,
    gmvCent: diagGmvCent,
    gmvYuan: centToYuan(diagGmvCent),
    homeGmvCent,
    homeGmvYuan: centToYuan(homeGmvCent),
    biGmvCent,
    biGmvYuan: centToYuan(biGmvCent),
    diagnosticsDashboardGmvCent: dashDiagCent,
    receivableCent: diag.sumReceivableCent,
    receivableYuan: centToYuan(diag.sumReceivableCent),
    actualSignedAmount: overview ? centToYuan(overview.actualSignedAmountCent) : null,
    actualSignedAmountCent: overview?.actualSignedAmountCent ?? null,
    returnAmount: overview ? centToYuan(overview.returnAmountCent) : null,
    returnAmountCent: overview?.returnAmountCent ?? null,
    grossProfit: overview ? centToYuan(overview.grossProfitCent) : centToYuan(gp.grossProfitCent),
    grossProfitCent: overview?.grossProfitCent ?? gp.grossProfitCent,
    matchedSettlementCount: gp.matchedSettlementCount,
    unmatchedSettlementCount: gp.unmatchedSettlementCount,
    targetGmvYuan: TARGET_GMV_YUAN,
    gmvMatchTarget: diagGmvCent === TARGET_GMV_CENT,
    threeWayConsistent: homeGmvCent === diagGmvCent && diagGmvCent === biGmvCent,
  }, null, 2))

  printSection('三处 GMV 对齐')
  console.log(`首页快照 GMV:     ${centToYuan(homeGmvCent)} 元 (${homeGmvCent} 分)`)
  console.log(`诊断 sumOrderGmv: ${centToYuan(diagGmvCent)} 元 (${diagGmvCent} 分)`)
  console.log(`诊断 dashboard:   ${centToYuan(dashDiagCent)} 元 (${dashDiagCent} 分)`)
  console.log(`BI 视图 GMV 合计: ${centToYuan(biGmvCent)} 元 (${biGmvCent} 分)`)
  console.log(`目标:             ${TARGET_GMV_YUAN} 元 (${TARGET_GMV_CENT} 分)`)

  const ok =
    diagGmvCent === TARGET_GMV_CENT &&
    homeGmvCent === TARGET_GMV_CENT &&
    biGmvCent === TARGET_GMV_CENT &&
    homeGmvCent === diagGmvCent

  if (ok) {
    printSection('验收结论: 通过')
  } else {
    printSection('验收结论: 未通过')
    await exportGmvDiff(target.preset, target.startDate, target.endDate, diagGmvCent)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
