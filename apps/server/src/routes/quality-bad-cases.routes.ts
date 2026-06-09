import { Router } from 'express'
import { attachLocalViewer } from '../middleware/local-viewer.middleware'
import { requireMaintenanceTools } from '../middleware/maintenance.middleware'
import { queryQualityBadCases } from '../services/quality-badcase-query.service'
import { getQualityBadCaseCoverage } from '../services/quality-badcase-store.service'
import { verifyQualityBadCases } from '../services/quality-badcase-verify.service'
import { runOfficialQualityBadCaseSyncStep } from '../services/quality-badcase-auto-sync.service'

export const qualityBadCasesRouter = Router()

qualityBadCasesRouter.post('/sync', requireMaintenanceTools, attachLocalViewer, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { windowDays?: number; force?: boolean }
    const result = await runOfficialQualityBadCaseSyncStep({
      trigger: 'manual',
      failSoft: false,
      force: body.force === true,
    })
    if (!result.ok) {
      res.status(500).json({ ok: false, error: result.error ?? '同步失败' })
      return
    }
    res.json({ ok: true, message: '官方品质反馈同步完成' })
  } catch (e) {
    next(e)
  }
})

qualityBadCasesRouter.get('/debug/verify', requireMaintenanceTools, attachLocalViewer, async (req, res, next) => {
  try {
    const q = req.query
    const result = await verifyQualityBadCases({
      startDate: typeof q.startDate === 'string' ? q.startDate : undefined,
      endDate: typeof q.endDate === 'string' ? q.endDate : undefined,
    })
    res.json({ ok: true, ...result })
  } catch (e) {
    next(e)
  }
})

qualityBadCasesRouter.get('/', attachLocalViewer, async (req, res, next) => {
  try {
    const q = req.query
    const data = await queryQualityBadCases({
      startDate: typeof q.startDate === 'string' ? q.startDate : undefined,
      endDate: typeof q.endDate === 'string' ? q.endDate : undefined,
      anchorId: typeof q.anchorId === 'string' ? q.anchorId : undefined,
      buyerId: typeof q.buyerId === 'string' ? q.buyerId : undefined,
      page: q.page != null ? Number(q.page) : undefined,
      pageSize: q.pageSize != null ? Number(q.pageSize) : undefined,
      sort: typeof q.sort === 'string' ? q.sort : undefined,
      matchStatus: typeof q.matchStatus === 'string' ? q.matchStatus : undefined,
      source: typeof q.source === 'string' ? q.source : undefined,
    })
    const coverage = await getQualityBadCaseCoverage()
    res.json({ ok: true, coverage, ...data })
  } catch (e) {
    next(e)
  }
})
