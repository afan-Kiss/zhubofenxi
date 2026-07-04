import { logInfo, logWarn } from '../utils/server-log'
import { taskComplete, taskFail, taskStart } from '../utils/task-log'
import { prisma } from '../lib/prisma'
import { hasAnyEnabledApi } from './xhs-api-sync/xhs-api-registry'
import { syncOfficialQualityBadCases } from './official-quality-refund-sync.service'
import { getQualityBadCaseCoverage } from './quality-badcase-store.service'

export type QualityBadCaseSyncTrigger =
  | 'boot'
  | 'scheduled'
  | 'full_read'
  | 'page_view'
  | 'manual'

export type QualityBadCaseAutoSyncStatus = 'idle' | 'running' | 'failed'

const STALE_MS = 12 * 60 * 60 * 1000
const COVERAGE_GAP_MS = 24 * 60 * 60 * 1000
const PAGE_VIEW_DEBOUNCE_MS = 5 * 60 * 1000

let runningPromise: Promise<void> | null = null
let lastPageViewEnqueueAt = 0
let autoSyncStatus: QualityBadCaseAutoSyncStatus = 'idle'
let lastError: string | null = null
let lastTrigger: QualityBadCaseSyncTrigger | null = null
let lastAttemptAt: string | null = null

export interface QualityBadCaseSyncNeed {
  needed: boolean
  reason: string
}

export interface QualityFeedbackPublicStatus {
  lastSyncedAt: string | null
  autoSyncStatus: QualityBadCaseAutoSyncStatus
  statusMessage: string
  caseCount: number
  unmatchedCount: number
  windowDays: number
}

export async function assessQualityBadCaseSyncNeed(): Promise<QualityBadCaseSyncNeed> {
  const [caseCount, coverage] = await Promise.all([
    prisma.qualityBadCase.count(),
    getQualityBadCaseCoverage(),
  ])

  if (caseCount === 0) {
    return { needed: true, reason: 'empty' }
  }

  if (!coverage.lastSyncedAt) {
    return { needed: true, reason: 'missing_meta' }
  }

  const syncedMs = Date.parse(coverage.lastSyncedAt)
  if (!Number.isFinite(syncedMs) || Date.now() - syncedMs > STALE_MS) {
    return { needed: true, reason: 'stale' }
  }

  if (coverage.endTime) {
    const endMs = Date.parse(coverage.endTime.replace(' ', 'T'))
    if (Number.isFinite(endMs) && Date.now() - endMs > COVERAGE_GAP_MS) {
      return { needed: true, reason: 'coverage_gap' }
    }
  }

  return { needed: false, reason: 'fresh' }
}

function statusMessage(): string {
  if (autoSyncStatus === 'running') {
    return '品退数据自动更新中'
  }
  if (autoSyncStatus === 'failed') {
    if (
      lastError &&
      /签名|xhshow|Python|python|script_not_found|sign_generation/i.test(lastError)
    ) {
      return '品退数据最近一次刷新失败（签名模块问题），当前展示上次成功同步的数据。订单 Cookie 可能仍可用。'
    }
    return '品退数据暂未更新成功，系统稍后会自动重试。'
  }
  return ''
}

export async function buildQualityFeedbackPublicStatus(): Promise<QualityFeedbackPublicStatus> {
  const [caseCount, unmatchedCount, coverage] = await Promise.all([
    prisma.qualityBadCase.count(),
    prisma.qualityBadCase.count({ where: { matchStatus: 'unmatched' } }),
    getQualityBadCaseCoverage(),
  ])
  const msg = statusMessage()
  return {
    lastSyncedAt: coverage.lastSyncedAt,
    autoSyncStatus,
    statusMessage: msg,
    caseCount,
    unmatchedCount,
    windowDays: coverage.windowDays,
  }
}

let lastPerAccount: import('./official-quality-refund-sync.service').QualityBadCasePerAccountRow[] =
  []

async function runSyncInternal(
  trigger: QualityBadCaseSyncTrigger,
  options?: { windowDays?: number; liveAccountIds?: string[] },
): Promise<void> {
  lastTrigger = trigger
  lastAttemptAt = new Date().toISOString()
  autoSyncStatus = 'running'
  lastError = null
  lastPerAccount = []
  try {
    if (!hasAnyEnabledApi()) {
      logInfo('品退同步', '跳过：接口未配置')
      autoSyncStatus = 'idle'
      return
    }
    taskStart('品退同步', `开始同步商品问题售后（触发：${trigger}），用于品退/品质问题统计，不影响支付金额`)
    const result = await syncOfficialQualityBadCases({
      windowDays: options?.windowDays ?? 30,
      liveAccountIds: options?.liveAccountIds,
    })
    lastPerAccount = result.perAccount
    autoSyncStatus = 'idle'
    taskComplete('品退同步', `同步结束（触发：${trigger}）`)
  } catch (err) {
    const message = err instanceof Error ? err.message : '官方品质反馈同步失败'
    lastError = message
    autoSyncStatus = 'failed'
    const useCache =
      /签名|xhshow|Python|python|script_not_found|sign_generation/i.test(message)
    taskFail(
      '品退同步',
      useCache
        ? `${message}；已继续使用上次成功数据，不影响订单/支付数据`
        : message,
    )
  }
}

export function enqueueOfficialQualityBadCaseSync(
  trigger: QualityBadCaseSyncTrigger,
  options?: { force?: boolean },
): void {
  if (runningPromise) return

  if (trigger === 'page_view') {
    const now = Date.now()
    if (now - lastPageViewEnqueueAt < PAGE_VIEW_DEBOUNCE_MS) return
    lastPageViewEnqueueAt = now
  }

  const start = async () => {
    if (!options?.force) {
      const need = await assessQualityBadCaseSyncNeed()
      if (!need.needed) return
    }
    runningPromise = runSyncInternal(trigger)
    try {
      await runningPromise
    } finally {
      runningPromise = null
    }
  }

  setImmediate(() => {
    void start()
  })
}

export async function runOfficialQualityBadCaseSyncStep(options: {
  trigger: QualityBadCaseSyncTrigger
  failSoft?: boolean
  force?: boolean
  windowDays?: number
  liveAccountIds?: string[]
}): Promise<{
  ok: boolean
  error?: string
  perAccount?: import('./official-quality-refund-sync.service').QualityBadCasePerAccountRow[]
}> {
  if (runningPromise) {
    try {
      await runningPromise
      return {
        ok: autoSyncStatus !== 'failed',
        error: lastError ?? undefined,
        perAccount: lastPerAccount,
      }
    } catch {
      return { ok: false, error: lastError ?? '同步进行中', perAccount: lastPerAccount }
    }
  }

  if (!options.force) {
    const need = await assessQualityBadCaseSyncNeed()
    if (!need.needed) {
      return { ok: true, perAccount: [] }
    }
  }

  runningPromise = runSyncInternal(options.trigger, {
    windowDays: options.windowDays,
    liveAccountIds: options.liveAccountIds,
  })
  try {
    await runningPromise
    const ok = autoSyncStatus !== 'failed'
    return {
      ok,
      error: ok ? undefined : lastError ?? undefined,
      perAccount: lastPerAccount,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '官方品质反馈同步失败'
    if (!options.failSoft) throw err
    return { ok: false, error: message, perAccount: lastPerAccount }
  } finally {
    runningPromise = null
  }
}

export function scheduleOfficialQualityBadCaseSyncOnBoot(): void {
  setImmediate(() => {
    enqueueOfficialQualityBadCaseSync('boot')
  })
}

export function ensureOfficialQualityBadCaseFreshForPageView(): void {
  enqueueOfficialQualityBadCaseSync('page_view')
}

export function getOfficialQualityBadCaseAutoSyncDebugInfo(): {
  autoSyncStatus: QualityBadCaseAutoSyncStatus
  lastError: string | null
  lastTrigger: QualityBadCaseSyncTrigger | null
  lastAttemptAt: string | null
} {
  return {
    autoSyncStatus,
    lastError,
    lastTrigger,
    lastAttemptAt,
  }
}
