import { Router } from 'express'
import path from 'node:path'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import { getClientIp } from '../middleware/audit.middleware'
import { sendFail, sendOk } from '../utils/response'
import {
  createValidationPackage,
  getValidationPackageFile,
  listValidationPackages,
} from '../services/validation-package.service'
import { writeOperationLog } from '../services/audit.service'

export const validationRouter = Router()

const auditCtx = (req: import('express').Request) => ({
  requestId: req.requestId,
  ip: getClientIp(req),
  userAgent: req.headers['user-agent'] ?? undefined,
})

validationRouter.post(
  '/export-package',
  requireAuth,
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const snapshotId = String(req.body?.snapshotId ?? 'latest')
      const result = await createValidationPackage(snapshotId, req.user!.id, auditCtx(req))
      sendOk(res, result)
    } catch (err) {
      next(err)
    }
  },
)

validationRouter.get(
  '/packages',
  requireAuth,
  requireRole('super_admin'),
  async (_req, res, next) => {
    try {
      sendOk(res, await listValidationPackages())
    } catch (err) {
      next(err)
    }
  },
)

validationRouter.get(
  '/packages/:id/download',
  requireAuth,
  requireRole('super_admin'),
  async (req, res, next) => {
    try {
      const file = await getValidationPackageFile(req.params.id!)
      if (!file) {
        sendFail(res, '校验包不存在或尚未生成完成', 404)
        return
      }

      const ctx = auditCtx(req)
      await writeOperationLog({
        userId: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        action: 'validation_package_download',
        module: 'system',
        description: `下载校验包：${file.fileName}`,
        requestId: ctx.requestId ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        meta: { packageId: req.params.id, fileName: file.fileName },
      })

      res.download(path.resolve(file.filePath), file.fileName)
    } catch (err) {
      next(err)
    }
  },
)
