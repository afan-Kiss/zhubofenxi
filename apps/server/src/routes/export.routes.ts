import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import {
  buildAnchorAuditExcelBuffer,
  buildAnchorAuditExportPayload,
  getAnchorAuditExportMeta,
} from '../services/anchor-audit-export.service'
import { sendFail, sendOk } from '../utils/response'
import { formatDateKeyShanghai } from '../utils/business-timezone'

export const exportRouter = Router()

exportRouter.use(attachRequestUser, requireAuth)

exportRouter.get('/anchor-audit/meta', async (req, res, next) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined
    const meta = await getAnchorAuditExportMeta({ startDate, endDate })
    sendOk(res, meta)
  } catch (err) {
    next(err)
  }
})

function resolveExportRange(query: Record<string, unknown>): { startDate: string; endDate: string } | null {
  const endDate = String(query.endDate ?? formatDateKeyShanghai(new Date())).trim()
  const startDate = String(query.startDate ?? '').trim()
  if (!startDate) return null
  return { startDate, endDate }
}

exportRouter.get('/anchor-audit.json', async (req, res, next) => {
  try {
    const range = resolveExportRange(req.query as Record<string, unknown>)
    if (!range) {
      sendFail(res, '请提供 startDate，或使用 meta 接口获取最早订单日期', 400)
      return
    }
    const payload = await buildAnchorAuditExportPayload({
      ...range,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    sendOk(res, payload)
  } catch (err) {
    next(err)
  }
})

exportRouter.get('/anchor-audit.xlsx', async (req, res, next) => {
  try {
    const range = resolveExportRange(req.query as Record<string, unknown>)
    if (!range) {
      sendFail(res, '请提供 startDate，或使用 meta 接口获取最早订单日期', 400)
      return
    }
    const { buffer, filename } = await buildAnchorAuditExcelBuffer({
      ...range,
      role: req.user!.role as import('../types/roles').UserRole,
      username: req.user!.username,
    })
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})
