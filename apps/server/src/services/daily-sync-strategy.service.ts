import { prisma } from '../lib/prisma'
import type { DateRangePreset, DateRangeResolved } from '../utils/date-range'
import { resolveDateRange, resolveRollingDays } from '../utils/date-range'
import { getDecryptedCookie } from './credential.service'
import {
  listEnabledLiveAccountsWithCookie,
  markCookieCheckResult,
  markLiveAccountSyncSuccess,
} from './live-account.service'
import type { CookieHealthStatus } from '../utils/xhs-auth.util'
import { getXhsSignStatus } from './xhs-sign-status.service'
import { getSyncStrategySettings } from './system-setting.service'
import { hasAnyEnabledApi } from './xhs-api-sync/xhs-api-registry'
import { syncOrderList } from './xhs-api-sync/xhs-order-sync.service'
import { syncLiveSessionList } from './xhs-api-sync/xhs-live-sync.service'
import {
  XHS_API_NOT_CONFIGURED_MSG,
  XHS_SYNC_STEP_LABELS,
  type XhsSyncJobStatus,
} from './xhs-api-sync/xhs-api-types'
import { createSyncProgressReporter } from './xhs-api-sync/xhs-sync-progress.service'
import { runAnalysisPipelineFromXhsRaw } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { toDashboardResponse } from './dashboard-api.service'
import { refreshTrackingPoolFromRaw, recheckTrackingPool } from './order-tracking-pool.service'
import { detectHistoricalAdjustments } from './historical-adjustment.service'
import {
  getMonthlyDataStatus,
  primaryMonthKeyFromRange,
  refreshMonthlyDataStatuses,
} from './monthly-data-status.service'
import { centToYuan } from '../utils/money'
import { BUSINESS_SYNC_LOOKBACK_DAYS } from '../config/business-sync.constants'
import {
  BUSINESS_SYNC_STALE_ERROR_MSG,
  clearStaleBusinessSyncJobs,
} from './business-sync-stale-cleanup.service'
import { logInfo, logWarn } from '../utils/server-log'
import { taskComplete, taskFail, taskStart } from '../utils/task-log'
import {
  logBusinessSyncAccountSummary,
  logBusinessSyncContinueNext,
  logBusinessSyncPrepare,
  logBusinessSyncRoundComplete,
  type AccountSyncSummaryLine,
} from '../utils/sync-cmd-log'
import { invalidateAndRebuildBusinessBoardCache } from './business-cache.service'

export const BUSINESS_SYNC_SETTLEMENT_SKIPPED_NOTE =
  '经营BI同步已跳过待结算/已结算账单（settlementSkippedForBusinessBI）'

/**
 * 经营同步任务模式（职责分离）：
 * - business_core：interval/startup/catchup 默认；仅订单+直播+本地分析+经营缓存
 * - business_with_quality：在 core 基础上额外跑官方品退同步
 * - quality_only / after_sale_only / full_maintenance：维护任务专用
 */
export type BusinessSyncMode =
  | 'business_core'
  | 'business_with_quality'
  | 'quality_only'
  | 'after_sale_only'
  | 'full_maintenance'

export const DEFAULT_BUSINESS_SYNC_MODE: BusinessSyncMode = 'business_core'

/** business_core 允许的外部平台 API：订单列表、直播场次（主播归属需要直播场次） */
export const BUSINESS_CORE_PLATFORM_APIS = ['syncOrderList', 'syncLiveSessionList'] as const

/** business_core 禁止：官方品退、售后工作台、售后时间范围查询、买家排行重建 */

const RANGE_PRESETS: DateRangePreset[] = ['today', 'thisMonth', 'lastMonth']

type AuditCtx = { requestId?: string; ip?: string; userAgent?: string }

async function markAccountAuthFailure(
  account: { id: string; name: string },
  api: string,
  message: string,
  status: CookieHealthStatus = 'invalid',
): Promise<void> {
  await markCookieCheckResult(account.id, {
    status,
    errorCode: status === 'suspected' ? 'suspected' : 'auth_expired',
    errorMessage: message,
    failedApi: api,
    affectedBusinessSync: true,
  })
}

async function syncDataForPreset(
  preset: DateRangePreset,
  job: { id: string; type: string; preset: string },
  range: DateRangeResolved,
  userId: string,
  audit?: AuditCtx,
): Promise<boolean> {
  const pipeline = await runAnalysisPipelineFromXhsRaw(range, {
    userId,
    requestId: audit?.requestId,
    ip: audit?.ip,
    userAgent: audit?.userAgent,
  })

  if (!pipeline?.result) return false
  if (
    pipeline.trustStatus !== 'official_ready' &&
    pipeline.trustStatus !== 'preview_only'
  ) {
    return false
  }

  const monthKey = primaryMonthKeyFromRange(range.startDate, range.endDate)
  const monthlyStatus = await getMonthlyDataStatus(monthKey)

  void monthlyStatus
  void userId
  void pipeline
  return true
}

export async function runDailyStrategySyncJob(params: {
  triggeredBy?: string | null
  audit?: AuditCtx
  mode?: BusinessSyncMode
}): Promise<{ jobId: string; alreadyRunning: boolean }> {
  await clearStaleBusinessSyncJobs()

  const active = await prisma.xhsSyncJob.findFirst({
    where: {
      preset: 'daily_strategy',
      status: { in: ['running', 'pending'] },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (active) {
    return { jobId: active.id, alreadyRunning: true }
  }

  const triggeredBy = params.triggeredBy ?? null
  if (triggeredBy?.startsWith('manual:')) {
    const recentManual = await prisma.xhsSyncJob.findFirst({
      where: {
        preset: 'daily_strategy',
        startedBy: triggeredBy,
        createdAt: { gte: new Date(Date.now() - 90_000) },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (recentManual) {
      return {
        jobId: recentManual.id,
        alreadyRunning: ['running', 'pending'].includes(recentManual.status),
      }
    }
  }

  const strategy = await getSyncStrategySettings()
  const orderRange = resolveRollingDays(strategy.afterSaleLookbackDays)

  const job = await prisma.xhsSyncJob.create({
    data: {
      type: 'scheduled',
      status: 'pending',
      preset: 'daily_strategy',
      startDate: orderRange.startDate,
      endDate: orderRange.endDate,
      progress: 0,
      currentStep: 'idle',
      currentStepLabel: XHS_SYNC_STEP_LABELS.idle,
      rangeLabel: '每日策略同步',
      startedBy: params.triggeredBy ?? null,
    },
  })

  setImmediate(() => {
    void executeDailyStrategySync(job.id, params.audit, params.mode ?? DEFAULT_BUSINESS_SYNC_MODE)
  })

  return { jobId: job.id, alreadyRunning: false }
}

export async function executeDailyStrategySync(
  jobId: string,
  audit?: AuditCtx,
  mode: BusinessSyncMode = DEFAULT_BUSINESS_SYNC_MODE,
): Promise<void> {
  const job = await prisma.xhsSyncJob.findUnique({ where: { id: jobId } })
  if (!job || job.status !== 'pending') return

  const startedAt = new Date()
  const userId =
    job.startedBy ??
    (
      await prisma.user.findFirst({
        where: { role: 'super_admin', enabled: true },
        orderBy: { createdAt: 'asc' },
      })
    )?.id

  if (!userId) {
    await prisma.xhsSyncJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage: '无可用超级管理员执行同步',
        finishedAt: new Date(),
      },
    })
    return
  }

  const strategy = await getSyncStrategySettings()
  const progress = createSyncProgressReporter(jobId, '每日策略同步')
  const warnings: string[] = [BUSINESS_SYNC_SETTLEMENT_SKIPPED_NOTE]
  let totalRequests = 0

  const bumpRequests = (count: number) => {
    totalRequests += count
  }

  await prisma.xhsSyncJob.update({
    where: { id: jobId },
    data: { status: 'running', startedAt, rangeLabel: '每日策略同步' },
  })

  try {
    await progress.setStep('idle', 2, '正在检查 Cookie 和签名')
    const { bootstrapQianfanCookiesForSync } = await import('./qianfan-cookie-resolver.service')
    await bootstrapQianfanCookiesForSync()
    await getDecryptedCookie()
    const signStatus = await getXhsSignStatus()
    if (!signStatus.signerModuleOk) warnings.push('签名模块未就绪')

    if (!hasAnyEnabledApi()) {
      throw new Error(XHS_API_NOT_CONFIGURED_MSG)
    }

    const ctx = { userId, ...audit }
    const accounts = await listEnabledLiveAccountsWithCookie()
    if (accounts.length === 0) {
      throw new Error('无启用直播号或未配置 Cookie，请先在系统设置添加直播号 Cookie')
    }

    const orderRange = resolveRollingDays(
      Math.max(strategy.afterSaleLookbackDays, BUSINESS_SYNC_LOOKBACK_DAYS),
    )

    logBusinessSyncPrepare({
      lookbackDays: BUSINESS_SYNC_LOOKBACK_DAYS,
      accounts: accounts.map((a) => ({ name: a.name, id: a.id })),
    })

    taskStart(
      '经营同步',
      `经营数据同步，范围 ${orderRange.startDate}~${orderRange.endDate}（最近 ${BUSINESS_SYNC_LOOKBACK_DAYS} 天），共 ${accounts.length} 个直播号`,
    )

    let totalOrders = 0
    let totalLive = 0
    const totalPending = 0
    const totalSettled = 0
    let successAccountCount = 0
    let authFailedAccountCount = 0
    const accountSummaries: AccountSyncSummaryLine[] = []
    const qualityByAccount = new Map<string, number>()

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i]!
      const accountIndex = i + 1
      const accountTotal = accounts.length
      let accountAuthFailed = false
      let accountFailReason: string | undefined
      let accountOrderApiRows = 0
      let accountLiveApiRows = 0
      let accountOrderSaved = 0
      let accountLiveSaved = 0

      await progress.setStep(
        'syncing_order_list',
        10,
        `同步直播号「${account.name}」最近 ${BUSINESS_SYNC_LOOKBACK_DAYS} 天订单`,
      )
      const orderList = await syncOrderList({
        syncJobId: jobId,
        startDate: orderRange.startDate,
        endDate: orderRange.endDate,
        context: ctx,
        progress,
        liveAccountId: account.id,
        liveAccountName: account.name,
        accountIndex,
        accountTotal,
      })
      bumpRequests(orderList.requestCount)
      warnings.push(...orderList.warnings.map((w) => `「${account.name}」${w}`))
      accountOrderApiRows = orderList.apiRowCount ?? orderList.itemCount
      accountOrderSaved = orderList.itemCount

      if (orderList.authFailed) {
        accountAuthFailed = true
        accountFailReason = orderList.warnings.at(-1) ?? 'Cookie 已失效'
        await markAccountAuthFailure(account, 'order_list', accountFailReason)
      } else {
        totalOrders += orderList.itemCount
      }

      if (!accountAuthFailed) {
        await progress.setStep(
          'syncing_live_list',
          25,
          `同步直播号「${account.name}」最近 ${BUSINESS_SYNC_LOOKBACK_DAYS} 天直播场次`,
        )
        const liveList = await syncLiveSessionList({
          syncJobId: jobId,
          startDate: orderRange.startDate,
          endDate: orderRange.endDate,
          context: ctx,
          progress,
          liveAccountId: account.id,
          liveAccountName: account.name,
          accountIndex,
          accountTotal,
        })
        bumpRequests(liveList.requestCount)
        warnings.push(...liveList.warnings.map((w) => `「${account.name}」${w}`))
        accountLiveApiRows = liveList.apiRowCount ?? liveList.itemCount
        accountLiveSaved = liveList.itemCount

        if (liveList.authFailed) {
          accountAuthFailed = true
          accountFailReason = liveList.warnings.at(-1) ?? 'Cookie 已失效'
          await markAccountAuthFailure(account, 'live_session_list', accountFailReason)
        } else {
          totalLive += liveList.itemCount
        }
      }

      if (accountAuthFailed) {
        authFailedAccountCount++
        warnings.push(`直播号「${account.name}」Cookie 失效，本轮已跳过该账号`)
        accountSummaries.push({
          accountName: account.name,
          liveAccountId: account.id,
          orders: accountOrderApiRows,
          afterSales: 0,
          qualityCases: 0,
          liveSessions: accountLiveApiRows,
          status: '失败',
          failReason: accountFailReason,
        })
      } else {
        const noData =
          accountOrderApiRows === 0 &&
          accountLiveApiRows === 0
        successAccountCount++
        await markLiveAccountSyncSuccess(account.id)
        accountSummaries.push({
          accountName: account.name,
          liveAccountId: account.id,
          orders: accountOrderApiRows,
          afterSales: 0,
          qualityCases: 0,
          liveSessions: accountLiveApiRows,
          status: noData ? '无新数据' : '成功',
        })
      }

      if (accountAuthFailed && i + 1 < accounts.length) {
        logBusinessSyncContinueNext({
          accountName: accounts[i + 1]!.name,
          liveAccountId: accounts[i + 1]!.id,
          accountIndex: i + 2,
          accountTotal,
        })
      }

      await progress.touchHeartbeat(
        `直播号「${account.name}」同步完成（${accountIndex}/${accountTotal}）`,
      )
    }

    await prisma.xhsSyncJob.update({
      where: { id: jobId },
      data: {
        orderCount: totalOrders,
        liveSessionCount: totalLive,
        pendingCount: totalPending,
        settledCount: totalSettled,
      },
    })

    if (successAccountCount === 0 && authFailedAccountCount > 0) {
      const finishedAt = new Date()
      await prisma.xhsSyncJob.update({
        where: { id: jobId },
        data: {
          status: 'failed_auth',
          currentStep: 'failed',
          currentStepLabel: XHS_SYNC_STEP_LABELS.failed,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          progress: 100,
          errorMessage: '所有启用直播号 Cookie 均已失效',
        },
      })
      return
    }

    let qualityCaseCount = 0
    const shouldSyncQuality =
      mode === 'business_with_quality' ||
      mode === 'quality_only' ||
      mode === 'full_maintenance'
    if (shouldSyncQuality) {
      await progress.setStep('syncing_quality_badcase', 62, '正在同步官方品质反馈')
      const qualityResult = await (
        await import('./quality-badcase-auto-sync.service')
      ).runOfficialQualityBadCaseSyncStep({
        trigger: 'scheduled',
        failSoft: true,
        liveAccountIds: accounts.map((a) => a.id),
        windowDays: BUSINESS_SYNC_LOOKBACK_DAYS,
      })
      await progress.touchHeartbeat('官方品质反馈同步完成，正在更新追踪池')
      if (qualityResult.ok) {
        const qualityMeta = await prisma.qualityBadCaseSyncMeta.findUnique({
          where: { id: 'default' },
          select: { caseCount: true },
        })
        qualityCaseCount = qualityMeta?.caseCount ?? 0
        const perAccount = qualityResult.perAccount ?? []
        for (const row of perAccount) {
          qualityByAccount.set(row.liveAccountId, row.caseCount)
        }
        for (const summary of accountSummaries) {
          if (summary.liveAccountId && qualityByAccount.has(summary.liveAccountId)) {
            summary.qualityCases = qualityByAccount.get(summary.liveAccountId) ?? 0
          }
        }
      }
      if (!qualityResult.ok && qualityResult.error) {
        warnings.push(`官方品质反馈：${qualityResult.error}`)
      }
    } else {
      warnings.push(
        `经营同步模式=${mode}：已跳过官方品退平台同步（由独立品退任务或 manual 触发）`,
      )
    }

    await progress.setStep('normalizing_data', 65, '更新未完结订单追踪池')
    await refreshTrackingPoolFromRaw(jobId)
    await recheckTrackingPool(jobId)
    await progress.touchHeartbeat('追踪池更新完成，正在检测历史调整项')

    await progress.setStep('analyzing_business', 72, '检测历史月份调整项')
    const adjCount = await detectHistoricalAdjustments(jobId)
    if (adjCount > 0) warnings.push(`检测到 ${adjCount} 条历史调整项`)

    await refreshMonthlyDataStatuses()
    await progress.touchHeartbeat('正在校验各日期范围数据')

    await progress.setStep('analyzing_business', 80, '校验各日期范围数据')
    let savedRanges = 0
    for (const preset of RANGE_PRESETS) {
      const range = resolveDateRange(preset)
      const ok = await syncDataForPreset(preset, job, range, userId, audit)
      if (ok) savedRanges++
    }

    const finishedAt = new Date()
    const finalStatus: XhsSyncJobStatus =
      savedRanges > 0
        ? warnings.length > 0 || authFailedAccountCount > 0
          ? 'partial_success'
          : 'success'
        : successAccountCount > 0
          ? 'success_empty'
          : authFailedAccountCount > 0
            ? 'failed_auth'
            : 'success_empty'

    await prisma.xhsSyncJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        currentStep: 'completed',
        currentStepLabel: XHS_SYNC_STEP_LABELS.completed,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        progress: 100,
        totalRequestCount: totalRequests,
        successRequestCount: totalRequests,
        errorMessage: warnings.length > 0 ? warnings.slice(0, 3).join('；') : null,
      },
    })

    const durationSec = (finishedAt.getTime() - startedAt.getTime()) / 1000
    logBusinessSyncAccountSummary(accountSummaries)
    logBusinessSyncRoundComplete({
      accountTotal: accounts.length,
      successCount: successAccountCount,
      failedCount: authFailedAccountCount,
      durationSec,
      extra: `订单合计 ${totalOrders} 单，直播 ${totalLive} 场，品退 ${qualityCaseCount} 条`,
    })
    if (finalStatus === 'failed_auth') {
      taskFail(
        '经营同步',
        `同步未成功：状态=${finalStatus}，订单 ${totalOrders} 单，直播 ${totalLive} 场`,
      )
    } else {
      taskComplete(
        '经营同步',
        `同步完成：订单 ${totalOrders} 单，直播 ${totalLive} 场，成功账号 ${successAccountCount} 个，Cookie 失效 ${authFailedAccountCount} 个，用时 ${durationSec} 秒`,
      )
      if (
        finalStatus === 'success' ||
        finalStatus === 'partial_success' ||
        finalStatus === 'success_empty'
      ) {
        try {
          await invalidateAndRebuildBusinessBoardCache('经营同步完成')
        } catch (cacheErr) {
          logWarn(
            '经营缓存',
            `同步后重建失败：${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`,
          )
        }
        try {
          const { runBossDashboardSync } = await import('./boss-dashboard/boss-dashboard-sync.service')
          await runBossDashboardSync(`business-sync:${job.startedBy ?? 'scheduled'}`)
        } catch (bossErr) {
          logWarn(
            '老板同步',
            `经营同步后老板数据步骤失败：${bossErr instanceof Error ? bossErr.message : String(bossErr)}`,
          )
        }
      }
    }
  } catch (err) {
    const finishedAt = new Date()
    const message = err instanceof Error ? err.message : '每日策略同步失败'
    taskFail('经营同步', message, err)
    await prisma.xhsSyncJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        currentStep: 'failed',
        currentStepLabel: XHS_SYNC_STEP_LABELS.failed,
        errorMessage: message,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    })
  } finally {
    try {
      const row = await prisma.xhsSyncJob.findUnique({
        where: { id: jobId },
        select: { status: true, startedAt: true },
      })
      if (row?.status === 'running') {
        const finishedAt = new Date()
        await prisma.xhsSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            currentStep: 'failed',
            currentStepLabel: XHS_SYNC_STEP_LABELS.failed,
            errorMessage: BUSINESS_SYNC_STALE_ERROR_MSG,
            finishedAt,
            durationMs: row.startedAt
              ? finishedAt.getTime() - row.startedAt.getTime()
              : null,
          },
        })
        logWarn('经营同步', `任务 ${jobId} 未正常结束，已在 finally 标记为失败`)
      }
    } catch (finallyErr) {
      logWarn(
        '经营同步',
        `释放任务 ${jobId} 失败：${finallyErr instanceof Error ? finallyErr.message : String(finallyErr)}`,
      )
    }
  }
}
