import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { requireMaintenanceTools } from '../middleware/maintenance.middleware'
import {
  getCredentialPublic,
  getDecryptedCookie,
  saveCredential,
  testCredentialDecrypt,
} from '../services/credential.service'
import {
  createLiveAccount,
  deleteLiveAccount,
  deleteLegacyDuplicateLiveAccounts,
  getLiveAccountCookiePlaintext,
  listLiveAccountsForSettings,
  refreshLiveAccountRowMapperContext,
  testLiveAccountCookie,
  updateLiveAccountCookie,
  updateLiveAccountMeta,
} from '../services/live-account.service'
import { getXhsSignStatus, recordSignTestResult } from '../services/xhs-sign-status.service'
import { testSignWithCookie } from '../services/xhs-sign.service'
import { writeOperationLog } from '../services/audit.service'
import { getClientIp } from '../middleware/audit.middleware'
import {
  listDownloadConfigs,
  restoreAllDownloadConfigsToAutoExport,
  updateDownloadConfig,
} from '../services/downloadConfig.service'
import { isDownloadType } from '../types/download'
import {
  getAmountDisplayMode,
  getAutoRefreshSettings,
  updateAutoRefreshSettings,
} from '../services/system-setting.service'
import {
  getAppFaviconPathSetting,
  setAppFaviconPathSetting,
} from '../services/app-favicon.service'
import { rescheduleFromSettings } from '../services/scheduler.service'
import type { DateRangePreset } from '../utils/date-range'
import { sendFail, sendOk } from '../utils/response'
import { clearBusinessDataForSettings } from '../services/clear-business-data.service'
import { triggerBusinessSyncIfStale } from '../services/business-sync-scheduler.service'

export const settingsRouter = Router()

settingsRouter.use(attachRequestUser, requireAuth)

/** 金额显示模式（原 /api/dashboard/display-settings，主看板仍使用） */
settingsRouter.get('/display-settings', async (_req, res) => {
  try {
    const amountDisplayMode = await getAmountDisplayMode()
    sendOk(res, { amountDisplayMode })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取显示设置失败', 500)
  }
})

settingsRouter.get('/app-favicon', async (_req, res) => {
  try {
    const appFaviconPath = await getAppFaviconPathSetting()
    sendOk(res, { appFaviconPath })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取网页图标设置失败', 500)
  }
})

settingsRouter.put('/app-favicon', async (req, res) => {
  try {
    const appFaviconPath = await setAppFaviconPathSetting(
      String(req.body?.appFaviconPath ?? req.body?.path ?? ''),
    )
    sendOk(res, {
      appFaviconPath,
      message: appFaviconPath ? '网页图标路径已保存' : '已清除自定义图标，将使用默认图标',
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '保存网页图标路径失败', 400)
  }
})

settingsRouter.get('/credential', async (_req, res) => {
  try {
    const data = await getCredentialPublic()
    sendOk(res, data)
  } catch {
    sendFail(res, '获取 Cookie 配置失败', 500)
  }
})

settingsRouter.put('/credential', async (req, res) => {
  const platformName = String(req.body?.platformName ?? 'xiaohongshu').trim()
  const cookie = String(req.body?.cookie ?? '')
  const remark = req.body?.remark != null ? String(req.body.remark) : undefined

  if (!cookie.trim()) {
    sendFail(res, '请填写 Cookie')
    return
  }

  try {
    const data = await saveCredential({
      platformName,
      cookie,
      remark,
      updatedBy: req.user!.id,
    })
    sendOk(res, {
      ...data,
      message: 'Cookie 已加密保存到服务端',
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '保存失败')
  }
})

settingsRouter.get('/credential/sign-status', async (req, res) => {
  const platformName = String(req.query.platformName ?? 'xiaohongshu').trim()
  try {
    const status = await getXhsSignStatus(platformName)
    sendOk(res, status)
  } catch {
    sendFail(res, '获取签名状态失败', 500)
  }
})

settingsRouter.post('/credential/test-sign', async (req, res) => {
  const platformName = String(req.body?.platformName ?? 'xiaohongshu').trim()
  try {
    const cookie = await getDecryptedCookie(platformName)
    const result = await testSignWithCookie(cookie)
    await recordSignTestResult(result.ok, result.ok ? null : result.message)

    const testUrlPath = '/api/edith/fulfillment/tool/file/start_export'
    await writeOperationLog({
      userId: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      action: result.ok ? 'xhs_sign_test_success' : 'xhs_sign_test_failed',
      module: 'settings',
      description: result.ok ? '小红书签名测试成功' : `小红书签名测试失败：${result.message}`,
      requestId: req.requestId ?? null,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
      meta: {
        urlPath: testUrlPath,
        hasXS: result.hasXS,
        hasAuthorization: result.hasAuthorization,
        errorMessage: result.ok ? null : result.message,
      },
    })

    sendOk(res, {
      ok: result.ok,
      hasXS: result.hasXS,
      hasXT: result.hasXT,
      hasXSCommon: result.hasXSCommon,
      hasAuthorization: result.hasAuthorization,
      hasA1: result.hasA1,
      hasWebSession: result.hasWebSession,
      message: result.message,
      reason: result.reason ?? null,
      qualitySignOk: result.qualitySignOk ?? false,
      qualitySignError: result.qualitySignError ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '签名测试失败'
    await recordSignTestResult(false, message)
    sendFail(res, message)
  }
})

settingsRouter.post('/credential/test', async (req, res) => {
  const platformName = String(req.body?.platformName ?? 'xiaohongshu').trim()
  try {
    const result = await testCredentialDecrypt(platformName)
    if (!result.ok) {
      sendFail(res, result.message)
      return
    }
    sendOk(res, result)
  } catch {
    sendFail(res, '测试失败', 500)
  }
})

settingsRouter.get('/download-configs', requireMaintenanceTools, async (_req, res) => {
  try {
    const configs = await listDownloadConfigs()
    sendOk(res, configs)
  } catch {
    sendFail(res, '获取下载配置失败', 500)
  }
})

settingsRouter.post('/download-configs/restore-auto-export', requireMaintenanceTools, async (_req, res) => {
  try {
    const configs = await restoreAllDownloadConfigsToAutoExport()
    sendOk(res, {
      configs,
      message: '四张表已恢复为自动导出模式',
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '恢复失败', 500)
  }
})

settingsRouter.get('/auto-refresh', requireMaintenanceTools, async (_req, res) => {
  try {
    const settings = await getAutoRefreshSettings()
    sendOk(res, {
      ...settings,
      notice:
        'Windows 本机 + 花生壳模式：电脑须开机、Node 服务须运行；睡眠或关机将导致凌晨自动刷新不执行。花生壳离线不影响本机下载，但影响外网访问。',
    })
  } catch {
    sendFail(res, '获取自动刷新设置失败', 500)
  }
})

settingsRouter.put('/auto-refresh', requireMaintenanceTools, async (req, res) => {
  try {
    const settings = await updateAutoRefreshSettings({
      autoRefreshEnabled:
        req.body?.autoRefreshEnabled !== undefined
          ? Boolean(req.body.autoRefreshEnabled)
          : undefined,
      autoRefreshTime:
        req.body?.autoRefreshTime != null
          ? String(req.body.autoRefreshTime)
          : undefined,
      autoRefreshPreset:
        req.body?.autoRefreshPreset != null
          ? (String(req.body.autoRefreshPreset) as DateRangePreset)
          : undefined,
      refreshTimezone:
        req.body?.refreshTimezone != null
          ? String(req.body.refreshTimezone)
          : undefined,
    })
    await rescheduleFromSettings()
    sendOk(res, { ...settings, message: '自动刷新设置已保存' })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '保存失败')
  }
})

settingsRouter.get('/live-accounts/cookie-health', async (_req, res) => {
  try {
    const { buildCookieHealthWithQualitySync } = await import(
      '../services/quality-badcase-sync-debug.service'
    )
    const payload = await buildCookieHealthWithQualitySync()
    sendOk(res, { ok: true, ...payload })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取 Cookie 健康状态失败', 500)
  }
})

settingsRouter.get('/live-accounts', async (_req, res) => {
  try {
    const accounts = await listLiveAccountsForSettings()
    sendOk(res, { accounts })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取直播号列表失败', 500)
  }
})

settingsRouter.post('/live-accounts', async (req, res) => {
  try {
    const account = await createLiveAccount({
      name: String(req.body?.name ?? ''),
      cookie: String(req.body?.cookie ?? ''),
      enabled: req.body?.enabled !== false,
      updatedBy: req.user!.id,
    })
    sendOk(res, {
      ...account,
      message: '直播号已创建',
    })
    await refreshLiveAccountRowMapperContext()
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '创建直播号失败')
  }
})

settingsRouter.get('/live-accounts/:id/cookie', async (req, res) => {
  try {
    const cookieText = await getLiveAccountCookiePlaintext(req.params.id)
    sendOk(res, { cookie: cookieText, cookieText })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '读取 Cookie 失败', 400)
  }
})

settingsRouter.post('/live-accounts/:id/test-cookie', async (req, res) => {
  try {
    const account = await (
      await import('../services/live-account.service')
    ).getLiveAccountById(req.params.id)
    const force = req.body?.force === true
    const result = await testLiveAccountCookie(req.params.id, { force })
    const name = account?.displayName?.trim() || account?.platformName || '未知直播号'
    sendOk(res, {
      ...result,
      liveAccountId: req.params.id,
      name,
      checkedAt: result.checkedAt ?? new Date().toISOString(),
      apiName: '订单接口',
      status:
        result.cookieStatus === 'valid' && result.ok
          ? 'valid'
          : 'invalid',
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : 'Cookie 测试失败')
  }
})

settingsRouter.put('/live-accounts/:id/cookie', async (req, res) => {
  try {
    const account = await updateLiveAccountCookie(
      req.params.id,
      String(req.body?.cookie ?? ''),
      req.user!.id,
    )
    sendOk(res, {
      ...account,
      message: 'Cookie 已更新',
    })
    await refreshLiveAccountRowMapperContext()
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '更新 Cookie 失败')
  }
})

settingsRouter.put('/live-accounts/:id', async (req, res) => {
  try {
    const account = await updateLiveAccountMeta(req.params.id, {
      name: req.body?.name != null ? String(req.body.name) : undefined,
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : undefined,
    }, { includeCookie: true })
    sendOk(res, account)
    await refreshLiveAccountRowMapperContext()
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '更新直播号失败')
  }
})

settingsRouter.post(
  '/data-maintenance/clear-business-data',
  async (req, res) => {
    try {
      const result = await clearBusinessDataForSettings({
        confirmPhrase: String(req.body?.confirmPhrase ?? ''),
        userId: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        audit: {
          requestId: req.requestId,
          ip: getClientIp(req),
          userAgent: req.headers['user-agent'] ?? undefined,
        },
      })
      sendOk(res, result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '清空业务数据失败'
      sendFail(res, msg, /请输入|进行中/.test(msg) ? 400 : 500)
    }
  },
)

settingsRouter.post(
  '/data-maintenance/trigger-business-sync',
  async (_req, res) => {
    try {
      const result = await triggerBusinessSyncIfStale('catchup')
      sendOk(res, {
        ok: true,
        result,
        message:
          result === 'started'
            ? '经营同步已启动'
            : result === 'queued'
              ? '经营同步已排队'
              : '经营同步未启动，请稍后在经营总览查看状态',
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '触发同步失败', 500)
    }
  },
)

settingsRouter.delete('/live-accounts/legacy-duplicates', async (_req, res) => {
  try {
    const result = await deleteLegacyDuplicateLiveAccounts()
    sendOk(res, {
      message:
        result.deletedCount > 0
          ? `已删除 ${result.deletedCount} 个历史重复账号`
          : '没有可删除的历史重复账号',
      ...result,
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '删除历史账号失败')
  }
})

settingsRouter.delete('/live-accounts/:id', async (req, res) => {
  try {
    await deleteLiveAccount(req.params.id)
    sendOk(res, { message: '直播号已删除' })
    await refreshLiveAccountRowMapperContext()
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '删除直播号失败')
  }
})

settingsRouter.put('/download-configs/:type', requireMaintenanceTools, async (req, res) => {
  const { type } = req.params
  if (!isDownloadType(type)) {
    sendFail(res, '下载类型无效')
    return
  }

  const name = String(req.body?.name ?? '')
  const url = String(req.body?.url ?? '')
  const method = String(req.body?.method ?? 'GET')
  const mode = req.body?.mode != null ? String(req.body.mode) : undefined
  const sellerId = req.body?.sellerId != null ? String(req.body.sellerId) : undefined
  const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : true
  const remark = req.body?.remark != null ? String(req.body.remark) : undefined

  try {
    const config = await updateDownloadConfig(type, {
      name,
      url,
      method,
      mode,
      sellerId,
      enabled,
      remark,
    })
    sendOk(res, config)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '保存失败')
  }
})

