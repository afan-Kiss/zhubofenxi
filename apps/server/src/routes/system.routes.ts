import { Router } from 'express'
import path from 'node:path'
import { attachLocalViewer } from '../middleware/local-viewer.middleware'
import { requireMaintenanceTools } from '../middleware/maintenance.middleware'
import { sendFail, sendOk } from '../utils/response'
import { getSystemStatus } from '../services/system-status.service'
import { createSystemBackup, getBackupById, listBackups } from '../services/system-backup.service'
import { previewCleanup, runCleanup } from '../services/system-cleanup.service'
import { getClientIp } from '../middleware/audit.middleware'
import { writeOperationLog } from '../services/audit.service'
import { getCleanupSettings, updateCleanupSettings } from '../services/system-setting.service'
import { runSystemAcceptanceChecks } from '../services/system-acceptance.service'
import {
  clearAllBusinessData,
  startFullDataRead,
  type FullReadScope,
} from '../services/data-management.service'
import { getDataSyncStatus } from '../services/data-sync-status.service'

export const systemRouter = Router()

const auditCtx = (req: import('express').Request) => ({
  requestId: req.requestId,
  ip: getClientIp(req),
  userAgent: req.headers['user-agent'] ?? undefined,
})

systemRouter.get('/status', requireMaintenanceTools, attachLocalViewer, async (_req, res, next) => {
  try {
    sendOk(res, await getSystemStatus())
  } catch (err) {
    next(err)
  }
})

systemRouter.get('/cleanup/preview', requireMaintenanceTools, attachLocalViewer, async (_req, res, next) => {
  try {
    sendOk(res, await previewCleanup())
  } catch (err) {
    next(err)
  }
})

systemRouter.get('/cleanup/settings', requireMaintenanceTools, attachLocalViewer, async (_req, res, next) => {
  try {
    sendOk(res, await getCleanupSettings())
  } catch (err) {
    next(err)
  }
})

systemRouter.post('/cleanup/settings', requireMaintenanceTools, attachLocalViewer, async (req, res, next) => {
  try {
    const updated = await updateCleanupSettings(req.body ?? {})
    sendOk(res, updated)
  } catch (err) {
    next(err)
  }
})

systemRouter.post('/cleanup', requireMaintenanceTools, attachLocalViewer, async (req, res, next) => {
  try {
    const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true'
    const result = await runCleanup(dryRun)
    const ctx = auditCtx(req)
    await writeOperationLog({
      userId: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      action: 'system_cleanup',
      module: 'system',
      description: dryRun ? '预览文件清理' : `执行文件清理，删除 ${result.deleted} 个文件`,
      requestId: ctx.requestId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { ...result } as Record<string, unknown>,
    })
    sendOk(res, result)
  } catch (err) {
    next(err)
  }
})

systemRouter.get('/acceptance', requireMaintenanceTools, attachLocalViewer, async (req, res, next) => {
  try {
    const preset = String(req.query.preset ?? 'today')
    sendOk(res, await runSystemAcceptanceChecks(preset as import('../utils/date-range').DateRangePreset))
  } catch (err) {
    next(err)
  }
})

systemRouter.get('/backups', requireMaintenanceTools, attachLocalViewer, async (_req, res, next) => {
  try {
    sendOk(res, listBackups())
  } catch (err) {
    next(err)
  }
})

systemRouter.post('/backup', requireMaintenanceTools, attachLocalViewer, async (req, res, next) => {
  try {
    const backup = await createSystemBackup()
    const ctx = auditCtx(req)
    await writeOperationLog({
      userId: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      action: 'backup_created',
      module: 'system',
      description: `创建系统备份：${backup.fileName}`,
      requestId: ctx.requestId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: { fileName: backup.fileName, fileSize: backup.fileSize },
    })
    sendOk(res, backup)
  } catch (err) {
    next(err)
  }
})

systemRouter.get(
  '/backups/:id/download',
  requireMaintenanceTools,
  attachLocalViewer,
  async (req, res, next) => {
    try {
      const backup = getBackupById(req.params.id!)
      if (!backup) {
        sendFail(res, '备份文件不存在', 404)
        return
      }
      const ctx = auditCtx(req)
      await writeOperationLog({
        userId: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        action: 'backup_downloaded',
        module: 'system',
        description: `下载备份：${backup.fileName}`,
        requestId: ctx.requestId ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        meta: { id: backup.id },
      })
      res.download(path.resolve(backup.filePath), backup.fileName)
    } catch (err) {
      next(err)
    }
  },
)

systemRouter.get(
  '/data/sync-status',
  requireMaintenanceTools,
  attachLocalViewer,
  async (_req, res, next) => {
    try {
      sendOk(res, await getDataSyncStatus())
    } catch (err) {
      next(err)
    }
  },
)

systemRouter.post('/data/clear-all', requireMaintenanceTools, attachLocalViewer, async (req, res, next) => {
  try {
    const result = await clearAllBusinessData({
      confirmPhrase: String(req.body?.confirmPhrase ?? ''),
      userId: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      audit: auditCtx(req),
    })
    sendOk(res, result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '清空数据失败'
    sendFail(res, msg, /请输入|进行中/.test(msg) ? 400 : 500)
  }
})

systemRouter.post('/data/full-read', requireMaintenanceTools, attachLocalViewer, async (req, res, next) => {
  try {
    const scope = String(req.body?.scope ?? '90') as FullReadScope
    const allowed: FullReadScope[] = ['30', '90', '180', 'custom', 'all']
    if (!allowed.includes(scope)) {
      sendFail(res, 'scope 无效，可选：30 / 90 / 180 / custom / all', 400)
      return
    }
    const result = await startFullDataRead({
      scope,
      startDate: req.body?.startDate ? String(req.body.startDate) : undefined,
      endDate: req.body?.endDate ? String(req.body.endDate) : undefined,
      triggeredBy: req.user!.id,
      audit: auditCtx(req),
    })
    await writeOperationLog({
      userId: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      action: 'full_data_read_start',
      module: 'system',
      description: `${req.user!.username} 启动全量读取（${scope}）`,
      requestId: auditCtx(req).requestId ?? null,
      ip: auditCtx(req).ip ?? null,
      userAgent: auditCtx(req).userAgent ?? null,
      meta: { ...result } as Record<string, unknown>,
    })
    sendOk(res, result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '启动全量读取失败'
    sendFail(res, msg, /必须|无效|配置/.test(msg) ? 400 : 500)
  }
})
