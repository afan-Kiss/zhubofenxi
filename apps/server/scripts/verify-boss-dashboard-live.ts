/**
 * 老板查看真实数据闭环验收（在服务器上运行：npx tsx apps/server/scripts/verify-boss-dashboard-live.ts）
 * 通过经营同步入口触发，不直接绕过架构调用老板同步。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../src/lib/prisma'
import { BOSS_DASHBOARD_SHOPS } from '../src/config/boss-dashboard.constants'
import {
  aggregateMonthlyStatementIncome,
  buildRecentMonthKeys,
} from '../src/services/boss-dashboard/boss-dashboard-flow.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import { getDataDir } from '../src/config/env'

const API_BASE = process.env.BOSS_LIVE_API_BASE ?? 'http://127.0.0.1:4723'
const LIVE_USERNAME = process.env.BOSS_LIVE_USERNAME ?? process.env.E2E_USER ?? ''
const LIVE_PASSWORD = process.env.BOSS_LIVE_PASSWORD ?? process.env.E2E_PASS ?? ''
const HTTP_TIMEOUT_MS = Number(process.env.BOSS_LIVE_HTTP_TIMEOUT_MS ?? 30_000)
const LOGIN_TIMEOUT_MS = Number(process.env.BOSS_LIVE_LOGIN_TIMEOUT_MS ?? 30_000)
const RUN_SYNC = process.env.BOSS_LIVE_RUN_SYNC === '1'
const SYNC_MAX_MS = Number(process.env.BOSS_LIVE_SYNC_MAX_SECONDS ?? '120') * 1000
const SHOP_KEYS = ['shiyuju', 'hetianyayu', 'xiangyu', 'xyxiangyu'] as const
const SHOP_NAMES: Record<string, string> = {
  shiyuju: '拾玉居和田玉',
  hetianyayu: '和田雅玉',
  xiangyu: '祥钰珠宝',
  xyxiangyu: 'XY祥钰珠宝',
}

type Report = Record<string, unknown>

const report: Report = { ok: true, issues: [] as string[] }

function issue(msg: string) {
  ;(report.issues as string[]).push(msg)
  report.ok = false
  console.log(`  ✗ ${msg}`)
}
function pass(msg: string) {
  console.log(`  ✓ ${msg}`)
}

function logStage(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
}

async function login(username: string, password: string): Promise<string | null> {
  logStage(`登录尝试 ${username} (timeout ${LOGIN_TIMEOUT_MS}ms)`)
  const t0 = Date.now()
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    })
    const setCookie = res.headers.get('set-cookie')
    if (!res.ok || !setCookie) {
      logStage(`登录失败 HTTP ${res.status} (${Date.now() - t0}ms)`)
      return null
    }
    const match = setCookie.match(/connect\.sid=[^;]+/)
    logStage(`登录成功 (${Date.now() - t0}ms)`)
    return match ? match[0] : null
  } catch (err) {
    logStage(`登录超时/异常: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

async function apiGet(cookie: string | null, urlPath: string): Promise<{ status: number; body: unknown }> {
  const res = await fetchWithTimeout(`${API_BASE}${urlPath}`, {
    headers: cookie ? { Cookie: cookie } : {},
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

async function apiPost(cookie: string, urlPath: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetchWithTimeout(`${API_BASE}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    parsed = null
  }
  return { status: res.status, body: parsed }
}

async function countBossAudit(apiPrefix: string): Promise<number> {
  const day = formatDateKeyShanghai()
  const file = path.join(getDataDir(), 'sync-request-audit', `${day}.jsonl`)
  let raw = ''
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return 0
  }
  let count = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const item = JSON.parse(line) as { apiName?: string; status?: string }
      if (!item.apiName?.startsWith(apiPrefix)) continue
      if (item.status === 'success' || item.status === 'failed') count++
    } catch {
      /* skip */
    }
  }
  return count
}

async function waitForSyncComplete(maxWaitMs: number): Promise<{ jobId: string | null; status: string; durationMs: number | null }> {
  const t0 = Date.now()
  let lastJobId: string | null = null
  let polls = 0
  const maxPolls = Math.max(1, Math.ceil(maxWaitMs / 15_000))
  while (Date.now() - t0 < maxWaitMs && polls < maxPolls) {
    polls++
    logStage(`轮询经营同步状态 #${polls}/${maxPolls}`)
    const res = await apiGet(null, '/api/sync/status')
    const data = res.body as { data?: { job?: { id?: string; status?: string; isRunning?: boolean; finishedAt?: string; durationMs?: number } } }
    const job = data?.data?.job
    if (job?.id) lastJobId = job.id
    if (job && !job.isRunning && (job.status === 'success' || job.status === 'partial_success' || job.status === 'success_empty' || job.status === 'failed')) {
      return { jobId: lastJobId, status: job.status ?? 'unknown', durationMs: job.durationMs ?? Date.now() - t0 }
    }
    await new Promise((r) => setTimeout(r, 15_000))
  }
  return { jobId: lastJobId, status: 'timeout', durationMs: Date.now() - t0 }
}

async function queryFundSnapshots() {
  const rows: Record<string, unknown>[] = []
  for (const shopKey of SHOP_KEYS) {
    const snap = await prisma.bossFundSnapshot.findFirst({
      where: { shopKey },
      orderBy: { fetchedAt: 'desc' },
    })
    rows.push({
      shopKey,
      shopName: SHOP_NAMES[shopKey],
      liveAccountId: snap?.liveAccountId ?? null,
      hasSnapshot: !!snap,
      syncStatus: snap?.syncStatus ?? null,
      syncError: snap?.syncError ?? null,
      fetchedAt: snap?.fetchedAt?.toISOString() ?? null,
      availableAmountCent: snap?.availableAmountCent ?? null,
      withdrawingAmountCent: snap?.withdrawingAmountCent ?? null,
      balanceAmountCent: snap?.balanceAmountCent ?? null,
      frozenAmountCent: snap?.frozenAmountCent ?? null,
      afterSaleFrozenAmountCent: snap?.afterSaleFrozenAmountCent ?? null,
      depositBalanceCent: snap?.depositBalanceCent ?? null,
      debtAmountCent: snap?.debtAmountCent ?? null,
      todayIncomeCent: snap?.todayIncomeCent ?? null,
      yesterdayIncomeCent: snap?.yesterdayIncomeCent ?? null,
      canWithdraw: snap?.canWithdraw ?? null,
      withdrawnAmountCent: snap?.withdrawnAmountCent ?? null,
    })
  }
  return rows
}

async function queryFlowStats() {
  const stats: Record<string, unknown>[] = []
  for (const shopKey of SHOP_KEYS) {
    const total = await prisma.bossAccountFlow.count({ where: { shopKey } })
    const withdraw = await prisma.bossAccountFlow.count({
      where: { shopKey, flowKind: 'withdraw_success' },
    })
    const statement = await prisma.bossAccountFlow.count({
      where: { shopKey, flowKind: 'statement_in', incomeAmountCent: { gt: 0 } },
    })
    const earliest = await prisma.bossAccountFlow.findFirst({
      where: { shopKey },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    })
    const latest = await prisma.bossAccountFlow.findFirst({
      where: { shopKey },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    })
    const badStatement = await prisma.bossAccountFlow.count({
      where: {
        shopKey,
        flowType: 'STATEMENT_IN',
        incomeAmountCent: 0,
        outcomeAmountCent: { gt: 0 },
      },
    })
    stats.push({
      shopKey,
      totalFlows: total,
      withdrawSuccessFlows: withdraw,
      statementIncomeFlows: statement,
      badStatementOnlyOutcome: badStatement,
      earliestAt: earliest?.occurredAt?.toISOString() ?? null,
      latestAt: latest?.occurredAt?.toISOString() ?? null,
    })
  }
  return stats
}

async function verifyMonthlyCurves() {
  const months = buildRecentMonthKeys(12)
  const perShop = new Map<string, Array<{ month: string; amountCent: number }>>()
  for (const shopKey of SHOP_KEYS) {
    perShop.set(shopKey, await aggregateMonthlyStatementIncome(shopKey, months))
  }
  const table: Array<Record<string, unknown>> = []
  for (const month of months) {
    const row: Record<string, unknown> = { month }
    let sum = 0
    for (const shopKey of SHOP_KEYS) {
      const amount = perShop.get(shopKey)!.find((m) => m.month === month)?.amountCent ?? 0
      row[shopKey] = amount
      sum += amount
    }
    row.total = sum
    const manual = SHOP_KEYS.reduce(
      (s, k) => s + (perShop.get(k)!.find((m) => m.month === month)?.amountCent ?? 0),
      0,
    )
    if (sum !== manual) issue(`${month} 四店合计不等于分线相加`)
    table.push(row)
  }
  if (table.length === 12) pass('近12个月曲线核对表生成完成')
  else issue(`月度曲线缺月：${table.length}`)
  return table
}

async function queryScoreStats() {
  const rows: Record<string, unknown>[] = []
  for (const shopKey of SHOP_KEYS) {
    const latest = await prisma.bossShopScoreSnapshot.findFirst({
      where: { shopKey },
      orderBy: { scoreDate: 'desc' },
    })
    const count = await prisma.bossShopScoreSnapshot.count({ where: { shopKey } })
    rows.push({
      shopKey,
      scoreDate: latest?.scoreDate ?? null,
      qualityScore: latest?.qualityScore ?? null,
      logisticsScore: latest?.logisticsScore ?? null,
      serviceScore: latest?.serviceScore ?? null,
      officialOverallScore: latest?.officialOverallScore ?? null,
      historyPoints: count,
      fetchedAt: latest?.fetchedAt?.toISOString() ?? null,
    })
  }
  return rows
}

async function main() {
  console.log('verify-boss-dashboard-live')
  const shanghaiHm = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
  report.shanghaiTime = shanghaiHm
  console.log(`  上海时间 ${shanghaiHm}`)

  const auditBefore = await countBossAudit('boss_')
  report.auditBossBefore = auditBefore

  const adminCookie = LIVE_USERNAME && LIVE_PASSWORD
    ? await login(LIVE_USERNAME, LIVE_PASSWORD)
    : null
  if (!adminCookie) {
    issue('缺少授权测试会话：未配置 BOSS_LIVE_USERNAME/BOSS_LIVE_PASSWORD 或登录失败')
    report.authSession = false
  } else {
    report.authSession = true
    pass('管理员登录成功')
  }

  const unauth = await apiGet(null, '/api/boss-dashboard')
  if (unauth.status === 401) pass('未登录返回 401')
  else issue(`未登录应 401，实际 ${unauth.status}`)

  if (adminCookie) {
    const staffUser = await prisma.user.findFirst({
      where: { role: 'staff', enabled: true },
      select: { username: true },
    })
    if (staffUser?.username) {
      const staffPass = process.env.BOSS_LIVE_STAFF_PASSWORD ?? LIVE_PASSWORD
      const staffCookie = staffPass ? await login(staffUser.username, staffPass) : null
      if (staffCookie) {
        const staffRes = await apiGet(staffCookie, '/api/boss-dashboard')
        if (staffRes.status === 403) pass(`staff(${staffUser.username}) 返回 403`)
        else issue(`staff 应 403，实际 ${staffRes.status}`)
      } else {
        issue(`staff(${staffUser.username}) 登录失败`)
      }
    } else {
      console.log('  · 无 staff 用户，跳过 staff 403 测试')
    }
  }

  if (RUN_SYNC && adminCookie) {
    const trigger = await apiPost(adminCookie, '/api/settings/data-maintenance/trigger-business-sync')
    const triggerBody = trigger.body as { data?: { syncJobId?: string; alreadyRunning?: boolean } }
    const syncJobId = triggerBody?.data?.syncJobId ?? null
    report.syncJobId = syncJobId
    report.syncTriggerStatus = trigger.status
    if (trigger.status === 200) pass(`经营同步已触发 jobId=${syncJobId}`)
    else issue(`触发经营同步失败 HTTP ${trigger.status}`)

    const syncResult = await waitForSyncComplete(SYNC_MAX_MS)
    report.syncStatus = syncResult.status
    report.syncDurationMs = syncResult.durationMs
    if (syncResult.status === 'success' || syncResult.status === 'partial_success' || syncResult.status === 'success_empty') {
      pass(`经营同步完成 status=${syncResult.status} 耗时 ${Math.round((syncResult.durationMs ?? 0) / 1000)}s`)
    } else if (syncResult.status === 'timeout') {
      issue(`经营同步等待超时（${Math.round(SYNC_MAX_MS / 1000)}s），继续其他检查`)
    } else {
      issue(`经营同步未完成：${syncResult.status}`)
    }
  } else {
    report.syncSkipped = true
    report.syncSkipReason = RUN_SYNC ? '无授权会话' : 'BOSS_LIVE_RUN_SYNC!=1，跳过同步等待'
    logStage(report.syncSkipReason as string)
  }

  const bossRun = await prisma.bossSyncRunLog.findFirst({ orderBy: { startedAt: 'desc' } })
  report.bossSyncRun = bossRun
    ? {
        id: bossRun.id,
        status: bossRun.status,
        trigger: bossRun.trigger,
        errorMessage: bossRun.errorMessage,
        shopResults: bossRun.shopResults,
      }
    : null

  const auditAfter = await countBossAudit('boss_')
  report.auditBossAfter = auditAfter
  report.auditBossDelta = auditAfter - auditBefore

  const funds = await queryFundSnapshots()
  report.fundSnapshots = funds
  const successShops = funds.filter((f) => f.syncStatus === 'success' && f.hasSnapshot)
  if (successShops.length > 0) pass(`${successShops.length} 店资金快照成功`)
  else issue('四店均无成功资金快照')

  const xiangyu = funds.find((f) => f.shopKey === 'xiangyu')
  const xy = funds.find((f) => f.shopKey === 'xyxiangyu')
  if (xiangyu?.liveAccountId && xy?.liveAccountId && xiangyu.liveAccountId !== xy.liveAccountId) {
    pass('祥钰与 XY祥钰 liveAccountId 隔离')
  } else if (!xiangyu?.hasSnapshot && !xy?.hasSnapshot) {
    console.log('  · 祥钰/XY 尚无快照，跳过隔离比对')
  } else {
    issue('祥钰与 XY祥钰可能串店')
  }

  const flows = await queryFlowStats()
  report.flowStats = flows
  for (const f of flows) {
    if ((f.badStatementOnlyOutcome as number) > 0) {
      const miscounted = await prisma.bossAccountFlow.count({
        where: {
          shopKey: f.shopKey as string,
          flowKind: 'statement_in',
          flowType: 'STATEMENT_IN',
          incomeAmountCent: 0,
          outcomeAmountCent: { gt: 0 },
        },
      })
      if (miscounted > 0) issue(`${f.shopKey} 存在冲减计入到账风险`)
      else pass(`${f.shopKey} 冲减 STATEMENT_IN 未计入到账`)
    }
  }

  const monthTable = await verifyMonthlyCurves()
  report.monthlyIncomeTable = monthTable

  const scores = await queryScoreStats()
  report.scoreStats = scores

  const dash = adminCookie ? await apiGet(adminCookie, '/api/boss-dashboard') : { status: 0, body: null }
  if (!adminCookie) {
    issue('跳过授权老板看板 API：缺少授权测试会话')
  } else if (dash.status === 200) {
    pass('GET /api/boss-dashboard 授权 200')
  } else {
    issue(`老板看板 API 应 200，实际 ${dash.status}`)
  }

  if (adminCookie) {
    const dashBody = JSON.stringify(dash.body)
    if (!dashBody.includes('cookie') && !dashBody.match(/bankCard|idCard|收款账号/i)) {
      pass('老板看板响应无敏感字段')
    } else {
      issue('老板看板响应可能含敏感字段')
    }

    for (const shopKey of SHOP_KEYS) {
      const shopRes = await apiGet(adminCookie, `/api/boss-dashboard/shops/${shopKey}`)
      if (shopRes.status === 200) pass(`GET shops/${shopKey} 200`)
      else issue(`shops/${shopKey} 应 200，实际 ${shopRes.status}`)
    }

    const badShop = await apiGet(adminCookie, '/api/boss-dashboard/shops/invalid-shop')
    if (badShop.status === 400) pass('无效 shopKey 返回 400')
    else issue(`无效 shopKey 应 400，实际 ${badShop.status}`)

    const ann = await apiGet(adminCookie, '/api/boss-dashboard/announcements')
    if (ann.status === 200) pass('GET announcements 200')
    else issue(`announcements 应 200，实际 ${ann.status}`)
  }

  const auditAfterApi = await countBossAudit('boss_')
  if (auditAfterApi === auditAfter) pass('接口验收未增加平台请求审计')
  else issue('接口验收后审计计数增加，可能触发了远端请求')

  console.log('\n--- REPORT ---')
  console.log(JSON.stringify(report, null, 2))
  await prisma.$disconnect()
  process.exit(report.ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
