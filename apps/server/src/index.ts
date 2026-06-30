import {
  loadEnv,
  getDataDir,
  getPort,
  getListenHost,
  assertCookieEncryptionKey,
  getDownloadDir,
  getReportDir,
  getBackupDir,
  getValidationPackageDir,
  logDatabaseStartupDiagnostics,
} from './config/env'
import { ensureDefaultSettings } from './services/system-setting.service'
import { createApp } from './app'
import { ensureDefaultAdmin, ensurePrimarySuperAdmin } from './services/bootstrap.service'
import {
  ensureDefaultDownloadConfigs,
  migrateLegacyDownloadModes,
} from './services/downloadConfig.service'
import {
  ensureDefaultLiveAccount,
  refreshLiveAccountRowMapperContext,
} from './services/live-account.service'
import { refreshAnchorConfigCache } from './services/anchor.service'
import { startDeferredBootTasks } from './services/deferred-boot.service'
import { assertYoudaoLiveAnalysisLicense } from './services/youdao-license.service'
import { logError, logInfo } from './utils/server-log'

function formatFatalError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}

function registerFatalErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    logError('服务', `未捕获异常，进程即将退出：${err.message}`)
    console.error(formatFatalError(err))
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    logError('服务', `未处理的 Promise 拒绝，进程即将退出：${message}`)
    console.error(formatFatalError(reason))
    process.exit(1)
  })
}

registerFatalErrorHandlers()

loadEnv()
assertCookieEncryptionKey()
logDatabaseStartupDiagnostics()

const port = getPort()
const listenHost = getListenHost()

function listenHttp(
  app: ReturnType<typeof createApp>['app'],
  webMounted: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, listenHost, () => {
      const mode = webMounted ? 'API + 前端静态' : '仅 API（开发模式或未构建前端）'
      logInfo('服务', `已启动，本机访问 http://127.0.0.1:${port}（${mode}，listen=${listenHost}）`)
      resolve()
    })
    server.on('error', reject)
  })
}

async function main() {
  await assertYoudaoLiveAnalysisLicense()
  logInfo('授权', '有道云授权校验通过（直播分析=开）')

  getDataDir()
  getDownloadDir()
  getReportDir()
  getBackupDir()
  getValidationPackageDir()

  await ensureDefaultSettings()
  const { ensureDefaultPagePermissions } = await import('./services/page-permission.service')
  await ensureDefaultPagePermissions()
  await ensureDefaultAdmin()
  await ensurePrimarySuperAdmin()
  await ensureDefaultDownloadConfigs()
  await ensureDefaultLiveAccount()
  await refreshLiveAccountRowMapperContext()
  await migrateLegacyDownloadModes()
  await refreshAnchorConfigCache()

  const { app, webMounted } = createApp()
  await listenHttp(app, webMounted)

  startDeferredBootTasks()

  const { startGoodReviewImageCacheCleanupTimer } = await import(
    './services/good-review/good-review-image-proxy.service'
  )
  startGoodReviewImageCacheCleanupTimer()
}

main().catch((err) => {
  const detail =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String(err)
  logError('服务', `启动失败：${detail}`, err)
  process.exit(1)
})
