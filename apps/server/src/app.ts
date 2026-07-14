import cookieParser from 'cookie-parser'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import { getCorsOrigin, getDataDir } from './config/env'
import { ensureSqlitePragmas } from './lib/prisma'
import { getBusinessCacheHealthStats } from './services/business-cache.service'
import { accessLogMiddleware } from './middleware/access-log.middleware'
import { auditMiddleware } from './middleware/audit.middleware'
import { perfLogMiddleware } from './middleware/perf-log.middleware'
import { mountWebStatic } from './middleware/staticWeb'
import { errorHandlerMiddleware } from './middleware/error-handler.middleware'
import { resolveReportBuildMeta } from './utils/report-build-meta'
import { auditRouter } from './routes/audit.routes'
import { authRouter } from './routes/auth.routes'
import { downloadRouter } from './routes/download.routes'
import { reportsRouter } from './routes/reports.routes'
import { validationRouter } from './routes/validation.routes'
import { settingsRouter } from './routes/settings.routes'
import { systemRouter } from './routes/system.routes'
import { syncRouter } from './routes/sync.routes'
import { userRouter } from './routes/user.routes'
import { xhsTestRouter } from './routes/xhs-test.routes'
import { anchorRouter } from './routes/anchor.routes'
import { diagnosticsRouter } from './routes/diagnostics.routes'
import { analyticsRouter } from './routes/analytics.routes'
import { boardRouter } from './routes/board.routes'
import { debugRouter } from './routes/debug.routes'
import { qualityBadCasesRouter } from './routes/quality-bad-cases.routes'
import { goodReviewsRouter } from './routes/good-reviews.routes'
import { luckyGiftsRouter } from './routes/lucky-gifts.routes'
import { shopCookiesRouter } from './routes/shop-cookies.routes'
import { anchorPerformanceRouter } from './routes/anchor-performance.routes'
import { anchorSchedulesRouter } from './routes/anchor-schedules.routes'
import { bossDashboardRouter } from './routes/boss-dashboard.routes'
import { offlineDealRouter } from './routes/offline-deal.routes'
import { dailyReportImagesRouter } from './routes/daily-report-images.routes'
import { exportRouter } from './routes/export.routes'
import { appRouter } from './routes/app.routes'
import { mountMaintenanceRouter } from './middleware/maintenance-route-gate.middleware'

export function createApp() {
  const app = express()

  app.set('trust proxy', true)

  app.use(
    cors({
      origin: getCorsOrigin(),
      credentials: true,
    }),
  )

  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (/\/daily-report-images\/[^/]+\/file$/i.test(req.path)) return false
        return compression.filter(req, res)
      },
    }),
  )
  app.use(accessLogMiddleware)
  app.use(perfLogMiddleware)

  app.use(cookieParser())
  app.use(express.json({ limit: '1mb' }))
  app.use(auditMiddleware)

  getDataDir()
  void ensureSqlitePragmas()

  app.get('/api/health', (_req, res) => {
    const meta = resolveReportBuildMeta(false)
    res.json({
      ok: true,
      service: 'live-business-api',
      appVersion: meta.appVersion,
      gitCommit: meta.gitCommit,
      cache: getBusinessCacheHealthStats(),
    })
  })

  app.use('/api/app', appRouter)

  app.use('/api/auth', authRouter)
  app.use('/api/users', userRouter)
  app.use('/api/settings', settingsRouter)
  mountMaintenanceRouter(app, '/api/download', downloadRouter, '下载任务')
  app.use('/api/sync', syncRouter)
  mountMaintenanceRouter(app, '/api/xhs-test', xhsTestRouter, '小红书联调')
  app.use('/api/audit', auditRouter)
  mountMaintenanceRouter(app, '/api/reports', reportsRouter, '经营报告')
  mountMaintenanceRouter(app, '/api/validation', validationRouter, '校验包')
  app.use('/api/system', systemRouter)
  app.use('/api/anchors', anchorRouter)
  app.use('/api/diagnostics', diagnosticsRouter)
  app.use('/api/analytics', analyticsRouter)
  app.use('/api/board', boardRouter)
  app.use('/api/quality-bad-cases', qualityBadCasesRouter)
  app.use('/api/good-reviews', goodReviewsRouter)
  app.use('/api/board/lucky-gifts', luckyGiftsRouter)
  app.use('/api/shop-cookies', shopCookiesRouter)
  app.use('/api/anchor-schedules', anchorSchedulesRouter)
  app.use('/api/daily-report-images', dailyReportImagesRouter)
  app.use('/api/anchor-performance', anchorPerformanceRouter)
  app.use('/api/boss-dashboard', bossDashboardRouter)
  app.use('/api/offline-deals', offlineDealRouter)
  app.use('/api/export', exportRouter)
  mountMaintenanceRouter(app, '/api/debug', debugRouter, '调试')

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, success: false, message: '接口不存在' })
  })

  app.use(errorHandlerMiddleware)

  const webMounted = mountWebStatic(app)

  if (!webMounted) {
    app.use((_req, res) => {
      res.status(404).json({ ok: false, success: false, message: '接口不存在' })
    })
  }

  return { app, webMounted }
}
