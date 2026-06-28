import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { requireMaintenanceTools } from '../middleware/maintenance.middleware'
import { queryQualityBadCases } from '../services/quality-badcase-query.service'
import { verifyQualityBadCases } from '../services/quality-badcase-verify.service'
import { runOfficialQualityBadCaseSyncStep } from '../services/quality-badcase-auto-sync.service'

export const qualityBadCasesRouter = Router()

qualityBadCasesRouter.use(attachRequestUser, requireAuth)

qualityBadCasesRouter.post('/sync', requireMaintenanceTools, async (req, res, next) => {
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
    res.json({ ok: true, data: result })
  } catch (err) {
    next(err)
  }
})

qualityBadCasesRouter.get('/debug/verify', requireMaintenanceTools, async (req, res, next) => {
  try {
    const startDate = String(req.query.startDate ?? '')
    const endDate = String(req.query.endDate ?? '')
    const data = await verifyQualityBadCases({ startDate, endDate })
    res.json({ ok: true, data })
  } catch (err) {
    next(err)
  }
})

qualityBadCasesRouter.get('/', async (req, res, next) => {
  try {
    const startDate = String(req.query.startDate ?? '')
    const endDate = String(req.query.endDate ?? '')
    const page = Number(req.query.page ?? 1)
    const pageSize = Number(req.query.pageSize ?? 50)
    const data = await queryQualityBadCases({
      startDate,
      endDate,
      page,
      pageSize,
    })
    res.json({ ok: true, data })
  } catch (err) {
    next(err)
  }
})
