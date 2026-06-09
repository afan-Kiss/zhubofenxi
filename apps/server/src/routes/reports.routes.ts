import { Router } from 'express'
import path from 'node:path'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import { sendFail, sendOk } from '../utils/response'
import { createReportExport, getReportExportFile, resolveSnapshotForReport } from '../services/report-export.service'
import { buildReportSummaryText } from '../services/report-summary.service'
import { getClientIp } from '../middleware/audit.middleware'
import { writeOperationLog } from '../services/audit.service'

export const reportsRouter = Router()

const auditCtx = (req: import('express').Request) => ({
  requestId: req.requestId,
  ip: getClientIp(req),
  userAgent: req.headers['user-agent'] ?? undefined,
})

reportsRouter.post(
  '/export',
  requireAuth,
  requireRole('super_admin', 'boss'),
  async (req, res, next) => {
    try {
      const snapshotId = String(req.body?.snapshotId ?? 'latest')
      const result = await createReportExport(snapshotId, req.user!.id, auditCtx(req))
      sendOk(res, result)
    } catch (err) {
      next(err)
    }
  },
)

reportsRouter.get(
  '/download/:reportId',
  requireAuth,
  requireRole('super_admin', 'boss'),
  async (req, res, next) => {
    try {
      const file = await getReportExportFile(req.params.reportId!)
      if (!file) {
        sendFail(res, '报表不存在或尚未生成完成', 404)
        return
      }

      const ctx = auditCtx(req)
      await writeOperationLog({
        userId: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        action: 'report_download',
        module: 'dashboard',
        description: `下载报表：${file.fileName}`,
        requestId: ctx.requestId ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        meta: { reportId: req.params.reportId },
      })

      res.download(path.resolve(file.filePath), file.fileName)
    } catch (err) {
      next(err)
    }
  },
)

reportsRouter.get(
  '/summary-text',
  requireAuth,
  requireRole('super_admin', 'boss'),
  async (req, res, next) => {
    try {
      const snapshotId = String(req.query.snapshotId ?? 'latest')
      const dashboard = await resolveSnapshotForReport(snapshotId)
      if (!dashboard) {
        sendFail(res, '暂无分析数据', 404)
        return
      }
      const text = buildReportSummaryText(dashboard)
      sendOk(res, { text })
    } catch (err) {
      next(err)
    }
  },
)
