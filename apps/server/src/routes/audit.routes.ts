import { Router } from 'express'
import { attachLocalViewer } from '../middleware/local-viewer.middleware'
import { getClientIp } from '../middleware/audit.middleware'
import { requireMaintenanceTools } from '../middleware/maintenance.middleware'
import {
  endPageView,
  getAuditSummary,
  heartbeatPageView,
  listOperationLogs,
  listPageViewLogs,
  startPageView,
  writeOperationLog,
} from '../services/audit.service'
import { sendFail, sendOk } from '../utils/response'

export const auditRouter = Router()

auditRouter.post('/client-error', attachLocalViewer, async (req, res) => {
  const message = String(req.body?.message ?? '前端页面异常').slice(0, 500)
  const stack = req.body?.stack != null ? String(req.body.stack).slice(0, 2000) : undefined
  const path = req.body?.path != null ? String(req.body.path) : undefined
  try {
    await writeOperationLog({
      userId: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      action: 'client_error',
      module: 'system',
      description: message,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] ?? undefined,
      meta: { path, stack },
    })
    sendOk(res, { ok: true })
  } catch {
    sendFail(res, '记录失败', 500)
  }
})

auditRouter.post('/page-view/start', attachLocalViewer, async (req, res) => {
  const page = String(req.body?.page ?? '').trim()
  if (!page) {
    sendFail(res, '缺少页面标识')
    return
  }
  try {
    const viewId = await startPageView({
      userId: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      page,
      path: req.body?.path != null ? String(req.body.path) : undefined,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] ?? undefined,
    })
    sendOk(res, { viewId })
  } catch {
    sendFail(res, '记录页面访问失败', 500)
  }
})

auditRouter.post('/page-view/heartbeat', attachLocalViewer, async (req, res) => {
  const viewId = String(req.body?.viewId ?? '')
  if (!viewId) {
    sendFail(res, '缺少 viewId')
    return
  }
  const ok = await heartbeatPageView(viewId)
  sendOk(res, { ok })
})

auditRouter.post('/page-view/end', attachLocalViewer, async (req, res) => {
  const viewId = String(req.body?.viewId ?? '')
  if (!viewId) {
    sendFail(res, '缺少 viewId')
    return
  }
  await endPageView(viewId)
  sendOk(res, { success: true })
})

auditRouter.get('/logs', requireMaintenanceTools, attachLocalViewer, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
  try {
    const data = await listOperationLogs({
      page,
      pageSize,
      username: req.query.username ? String(req.query.username) : undefined,
      action: req.query.action ? String(req.query.action) : undefined,
      module: req.query.module ? String(req.query.module) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
    })
    sendOk(res, data)
  } catch {
    sendFail(res, '获取操作日志失败', 500)
  }
})

auditRouter.get('/page-views', requireMaintenanceTools, attachLocalViewer, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
  try {
    const data = await listPageViewLogs({
      page,
      pageSize,
      username: req.query.username ? String(req.query.username) : undefined,
      pageName: req.query.page ? String(req.query.page) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
    })
    sendOk(res, data)
  } catch {
    sendFail(res, '获取页面停留记录失败', 500)
  }
})

auditRouter.get('/summary', requireMaintenanceTools, attachLocalViewer, async (_req, res) => {
  try {
    const data = await getAuditSummary()
    sendOk(res, data)
  } catch {
    sendFail(res, '获取概览失败', 500)
  }
})
