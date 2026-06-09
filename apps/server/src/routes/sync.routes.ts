import { Router } from 'express'
import { getClientIp } from '../middleware/audit.middleware'
import { attachLocalViewer } from '../middleware/local-viewer.middleware'
import { requireMaintenanceTools } from '../middleware/maintenance.middleware'
import {
  getApiSyncSettings,
  updateApiSyncSettings,
  getSyncStrategySettings,
  updateSyncStrategySettings,
  type SyncStrategySettings,
  getAmountDisplayMode,
  setAmountDisplayMode,
  type AmountDisplayMode,
  type ApiSyncSettings,
} from '../services/system-setting.service'
import {
  getSyncStatusPayload,
  getXhsSyncJobDetail,
  mapSyncErrorForUser,
  runXhsSyncJob,
} from '../services/xhs-api-sync/xhs-sync-job.service'
import { getBusinessSyncStatus } from '../services/business-sync-scheduler.service'
import { listSyncJobLogs } from '../services/sync-job-log.service'
import { hasAnyEnabledApi } from '../services/xhs-api-sync/xhs-api-registry'
import { XHS_API_NOT_CONFIGURED_MSG } from '../services/xhs-api-sync/xhs-api-types'
import {
  type DateRangePreset,
} from '../utils/date-range'
import { validateSyncRangeInput, normalizeSyncPreset } from '../utils/sync-range-validation'
import { sendFail, sendOk } from '../utils/response'

export const syncRouter = Router()

type SyncDetailMode = 'none' | 'smart' | 'all'

export interface ApiSyncSettingsResponse {
  apiSyncEnabled: boolean
  apiSyncTime: string
  apiSyncPreset: DateRangePreset
  xhsRequestIntervalMs: number
  syncOrderDetailMode: SyncDetailMode
  syncLiveDetailMode: SyncDetailMode
  syncSettlementDetailMode: SyncDetailMode
  amountDisplayMode: AmountDisplayMode
  syncStrategy: SyncStrategySettings
}

function toDetailMode(enabled: boolean, stored?: string | null): SyncDetailMode {
  if (stored === 'none' || stored === 'smart' || stored === 'all') return stored
  return enabled ? 'smart' : 'none'
}

function settingsToResponse(s: ApiSyncSettings, modes?: {
  syncOrderDetailMode?: string | null
  syncLiveDetailMode?: string | null
  syncSettlementDetailMode?: string | null
}, strategy?: SyncStrategySettings): ApiSyncSettingsResponse {
  return {
    apiSyncEnabled: s.apiSyncEnabled,
    apiSyncTime: s.apiSyncTime,
    apiSyncPreset: s.apiSyncPreset,
    xhsRequestIntervalMs: s.xhsRequestIntervalMs,
    syncOrderDetailMode: toDetailMode(s.syncOrderDetailEnabled, modes?.syncOrderDetailMode),
    syncLiveDetailMode: toDetailMode(s.syncLiveDetailEnabled, modes?.syncLiveDetailMode),
    syncSettlementDetailMode: toDetailMode(
      s.syncSettledSettlementEnabled,
      modes?.syncSettlementDetailMode,
    ),
    amountDisplayMode: 'wan',
    syncStrategy: strategy ?? {
      orderRollingDays: 30,
      afterSaleLookbackDays: 90,
      settlementLookbackDays: 90,
      afterSaleObservationDays: 30,
      monthClosingStartDay: 1,
      monthClosingEndDay: 10,
    },
  }
}

async function settingsToResponseAsync(
  s: ApiSyncSettings,
  modes?: {
    syncOrderDetailMode?: string | null
    syncLiveDetailMode?: string | null
    syncSettlementDetailMode?: string | null
  },
): Promise<ApiSyncSettingsResponse> {
  const base = settingsToResponse(s, modes, await getSyncStrategySettings())
  base.amountDisplayMode = await getAmountDisplayMode()
  base.syncStrategy = await getSyncStrategySettings()
  return base
}

function normalizePreset(preset: string): DateRangePreset {
  return normalizeSyncPreset(preset)
}

const auditCtx = (req: import('express').Request) => ({
  requestId: req.requestId,
  ip: getClientIp(req),
  userAgent: req.headers['user-agent'] ?? undefined,
})

syncRouter.get('/status', attachLocalViewer, async (_req, res) => {
    try {
      const payload = await getSyncStatusPayload()
      const autoSync = await getBusinessSyncStatus()
      const job = payload.job
        ? {
            id: payload.job.syncJobId,
            syncJobId: payload.job.syncJobId,
            type: payload.job.type,
            preset: payload.job.preset,
            startDate: payload.job.startDate,
            endDate: payload.job.endDate,
            status: payload.job.status,
            progress: payload.job.progress,
            currentStep: payload.job.currentStep,
            currentStepLabel: payload.job.currentStepLabel,
            currentPage: payload.job.currentPage,
            totalPage: payload.job.totalPage,
            currentApiKey: payload.job.currentApiKey,
            currentApiLabel: payload.job.currentApiLabel,
            rangeLabel: payload.job.rangeLabel,
            totalRequestCount: payload.job.totalRequestCount,
            successRequestCount: payload.job.successRequestCount,
            failedRequestCount: payload.job.failedRequestCount,
            orderCount: payload.job.orderCount,
            liveSessionCount: payload.job.liveSessionCount,
            pendingCount: payload.job.pendingCount,
            settledCount: payload.job.settledCount,
            errorMessage: payload.job.errorMessage
              ? mapSyncErrorForUser(payload.job.errorMessage)
              : null,
            startedBy: payload.job.startedBy,
            startedAt: payload.job.startedAt,
            finishedAt: payload.job.finishedAt,
            durationMs: payload.job.durationMs,
            createdAt: payload.job.createdAt,
            isRunning: payload.job.isRunning,
            empty: payload.job.empty ?? payload.job.status === 'success_empty',
            outcome: payload.job.outcome ?? null,
            trustStatus: payload.job.trustStatus ?? null,
            validationSummary: payload.job.validationSummary ?? null,
          }
        : null
      sendOk(res, {
        running: payload.running,
        job,
        latest: payload.running ? null : job,
        settlementSkippedForBusinessBI: payload.settlementSkippedForBusinessBI,
        businessSync: {
          ...autoSync.businessSync,
          settlementSkippedForBusinessBI: true,
        },
        buyerRankingSync: autoSync.buyerRankingSync,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '获取同步状态失败', 500)
    }
})

syncRouter.get('/history', requireMaintenanceTools, attachLocalViewer, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const data = await listSyncJobLogs(page, pageSize)
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取同步历史失败', 500)
  }
})

syncRouter.get('/jobs/:id', requireMaintenanceTools, attachLocalViewer, async (req, res) => {
  try {
    const detail = await getXhsSyncJobDetail(req.params.id)
    if (!detail) {
      sendFail(res, '同步任务不存在', 404)
      return
    }
    sendOk(res, {
      ...detail.job,
      id: detail.job.syncJobId,
      errorMessage: detail.job.errorMessage
        ? mapSyncErrorForUser(detail.job.errorMessage)
        : null,
      empty: detail.job.empty ?? detail.job.status === 'success_empty',
      outcome: detail.job.outcome ?? null,
      trustStatus: detail.job.trustStatus ?? null,
      validationSummary: detail.job.validationSummary ?? null,
      steps: detail.steps,
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取任务详情失败', 500)
  }
})

syncRouter.get('/settings', attachLocalViewer, async (_req, res) => {
  try {
    const s = await getApiSyncSettings()
    const { getApiSyncPresets } = await import('../services/system-setting.service')
    const apiSyncPresets = await getApiSyncPresets()
    const { getSchedulerStatus } = await import('../services/scheduler.service')
    const scheduler = await getSchedulerStatus()
    const { getSetting } = await import('../services/system-setting.service')
    const modes = {
      syncOrderDetailMode: await getSetting('syncOrderDetailMode'),
      syncLiveDetailMode: await getSetting('syncLiveDetailMode'),
      syncSettlementDetailMode: await getSetting('syncSettlementDetailMode'),
    }
    sendOk(res, { ...(await settingsToResponseAsync(s, modes)), apiSyncPresets, scheduler })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '读取同步设置失败', 500)
  }
})

syncRouter.post('/settings', requireMaintenanceTools, attachLocalViewer, async (req, res) => {
  try {
    const body = req.body ?? {}
    const patch: Partial<ApiSyncSettings> = {}
    if (body.apiSyncEnabled !== undefined) patch.apiSyncEnabled = Boolean(body.apiSyncEnabled)
    if (body.apiSyncTime) patch.apiSyncTime = String(body.apiSyncTime)
    if (body.apiSyncPreset) patch.apiSyncPreset = normalizePreset(String(body.apiSyncPreset))
    if (body.apiSyncPresets !== undefined) {
      const { setApiSyncPresets } = await import('../services/system-setting.service')
      const presets = Array.isArray(body.apiSyncPresets)
        ? body.apiSyncPresets.map((p: unknown) => normalizePreset(String(p)))
        : []
      await setApiSyncPresets(presets)
    }
    if (body.amountDisplayMode) {
      await setAmountDisplayMode(String(body.amountDisplayMode) as AmountDisplayMode)
    }
    if (body.xhsRequestIntervalMs !== undefined) {
      patch.xhsRequestIntervalMs = Number(body.xhsRequestIntervalMs)
    }

    const { setSetting } = await import('../services/system-setting.service')
    if (body.syncOrderDetailMode) {
      const mode = String(body.syncOrderDetailMode) as SyncDetailMode
      await setSetting('syncOrderDetailMode', mode)
      patch.syncOrderDetailEnabled = mode !== 'none'
    }
    if (body.syncLiveDetailMode) {
      const mode = String(body.syncLiveDetailMode) as SyncDetailMode
      await setSetting('syncLiveDetailMode', mode)
      patch.syncLiveDetailEnabled = mode !== 'none'
    }
    if (body.syncSettlementDetailMode) {
      const mode = String(body.syncSettlementDetailMode) as SyncDetailMode
      await setSetting('syncSettlementDetailMode', mode)
    }

    if (body.syncStrategy && typeof body.syncStrategy === 'object') {
      await updateSyncStrategySettings(body.syncStrategy as Partial<SyncStrategySettings>)
    }

    const saved = await updateApiSyncSettings(patch)
    const modes = {
      syncOrderDetailMode: await import('../services/system-setting.service').then((m) =>
        m.getSetting('syncOrderDetailMode'),
      ),
      syncLiveDetailMode: await import('../services/system-setting.service').then((m) =>
        m.getSetting('syncLiveDetailMode'),
      ),
      syncSettlementDetailMode: await import('../services/system-setting.service').then((m) =>
        m.getSetting('syncSettlementDetailMode'),
      ),
    }
    sendOk(res, { ...(await settingsToResponseAsync(saved, modes)), saved: true })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '保存同步设置失败', 500)
  }
})

syncRouter.post('/run', requireMaintenanceTools, attachLocalViewer, async (req, res) => {
  try {
    const triggerSource = req.body?.triggerSource ? String(req.body.triggerSource) : ''

    if (triggerSource === 'auto_when_empty' || triggerSource === 'query_custom_range') {
      sendFail(res, '页面查询不会自动触发同步，请使用「刷新」按钮', 400)
      return
    }

    let preset: DateRangePreset
    let rangeStart: string
    let rangeEnd: string
    let jobType: 'manual' | 'scheduled' = 'manual'

    if (triggerSource === 'manual_schedule') {
      const { runDailyStrategySyncJob } = await import('../services/daily-sync-strategy.service')
      const { jobId, alreadyRunning } = await runDailyStrategySyncJob({
        triggeredBy: req.user!.id,
        audit: auditCtx(req),
      })
      sendOk(res, {
        ok: true,
        syncJobId: jobId,
        alreadyRunning,
        message: alreadyRunning
          ? '当前已有用户正在刷新数据，已为你显示当前刷新进度，请稍候。'
          : '每日策略同步任务已启动',
      })
      return
    }

    const validated = validateSyncRangeInput({
      preset: req.body?.preset,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
    })
    preset = validated.preset
    rangeStart = validated.startDate
    rangeEnd = validated.endDate

    if (!hasAnyEnabledApi()) {
      sendOk(res, {
        ok: false,
        message: XHS_API_NOT_CONFIGURED_MSG,
        alreadyRunning: false,
      })
      return
    }

    const { job, alreadyRunning } = await runXhsSyncJob({
      type: jobType,
      preset,
      startDate: rangeStart,
      endDate: rangeEnd,
      triggeredBy: req.user!.id,
      audit: auditCtx(req),
    })

    const { writeOperationLog } = await import('../services/audit.service')
    const { findUserById } = await import('../services/user.service')
    const triggerUser = await findUserById(req.user!.id)
    await writeOperationLog({
      userId: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      action: alreadyRunning ? 'api_sync_skipped' : 'api_sync_start',
      module: 'dashboard',
      description: alreadyRunning
        ? `${req.user!.username} 触发刷新但命中全局锁，复用进行中任务`
        : `${req.user!.username} 触发刷新【${preset}】`,
      ...auditCtx(req),
      meta: {
        preset,
        startDate: rangeStart,
        endDate: rangeEnd,
        alreadyRunning,
        reusedJobId: alreadyRunning ? job.syncJobId : null,
        syncJobId: job.syncJobId,
        triggeredBy: triggerUser?.username ?? req.user!.username,
        refreshLockHit: alreadyRunning,
      },
    })

    let startedByUsername: string | null = null
    if (job.startedBy) {
      const starter = await findUserById(job.startedBy)
      startedByUsername = starter?.username ?? null
    }

    sendOk(res, {
      ok: true,
      syncJobId: job.syncJobId,
      status: job.status,
      progress: job.progress,
      currentStep: job.currentStep,
      currentStepLabel: job.currentStepLabel,
      alreadyRunning,
      startedByUsername,
      message: alreadyRunning
        ? '当前已有用户正在刷新数据，已为你显示当前刷新进度，请稍候。'
        : '同步任务已启动',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '启动同步失败'
    const status = /缺少|拒绝|必须|不支持|自定义/.test(msg) ? 400 : 500
    sendFail(res, msg, status)
  }
})

syncRouter.post(
  '/after-sales-workbench',
  requireMaintenanceTools,
  attachLocalViewer,
  async (req, res) => {
    try {
      const orderNo = req.body?.orderNo ? String(req.body.orderNo).trim() : ''
      const liveAccountId = req.body?.liveAccountId
        ? String(req.body.liveAccountId).trim()
        : undefined
      if (orderNo) {
        const { syncWorkbenchForOrderNo } = await import(
          '../services/xhs-after-sales-workbench.service'
        )
        const result = await syncWorkbenchForOrderNo(orderNo, liveAccountId)
        sendOk(res, { ok: true, orderNo, result })
        return
      }
      const { syncAllOrdersWorkbenchFromRaw, processWorkbenchQueueBatch } = await import(
        '../services/xhs-after-sales-workbench.service'
      )
      const queue = await processWorkbenchQueueBatch(200)
      const full = await syncAllOrdersWorkbenchFromRaw()
      sendOk(res, {
        ok: true,
        message: '售后工作台退款金额补数已完成',
        queue,
        full,
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '售后工作台补数失败', 500)
    }
  },
)
