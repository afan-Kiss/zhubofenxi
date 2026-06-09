import { Router } from 'express'
import { getClientIp } from '../middleware/audit.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import {
  getBatchDetail,
  listRecentBatches,
  startDownloadBatch,
} from '../services/download-batch.service'
import {
  downloadAllEnabled,
  downloadByType,
  getTaskById,
  listRecentTasks,
} from '../services/download.service'
import { isDownloadType } from '../types/download'
import {
  type DateRangePreset,
  defaultThisMonthRange,
  resolveDateRange,
} from '../utils/date-range'
import { sendFail, sendOk } from '../utils/response'

export const downloadRouter = Router()

downloadRouter.use(requireAuth, requireRole('super_admin'))

function parseRange(req: { body?: Record<string, unknown> }) {
  const preset = (req.body?.preset ?? 'thisMonth') as DateRangePreset
  return resolveDateRange(
    preset,
    req.body?.startDate ? String(req.body.startDate) : undefined,
    req.body?.endDate ? String(req.body.endDate) : undefined,
  )
}

const auditCtx = (req: import('express').Request) => ({
  requestId: req.requestId,
  ip: getClientIp(req),
  userAgent: req.headers['user-agent'] ?? undefined,
})

downloadRouter.post('/batch', async (req, res) => {
  try {
    const range = parseRange(req)
    const detail = await startDownloadBatch(req.user!.id, range, auditCtx(req))
    sendOk(res, {
      batchId: detail.id,
      status: detail.status,
      tasks: detail.tasks,
      message: '批量下载任务已启动，请轮询查看进度',
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '批量下载启动失败', 500)
  }
})

downloadRouter.get('/batches', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50)
  try {
    const batches = await listRecentBatches(limit)
    sendOk(res, batches)
  } catch {
    sendFail(res, '获取批量下载记录失败', 500)
  }
})

downloadRouter.get('/batch/:id', async (req, res) => {
  try {
    const detail = await getBatchDetail(req.params.id)
    if (!detail) {
      sendFail(res, '批量下载任务不存在', 404)
      return
    }
    sendOk(res, detail)
  } catch {
    sendFail(res, '获取批量下载详情失败', 500)
  }
})

downloadRouter.post('/all', async (req, res) => {
  try {
    const range = parseRange(req)
    const tasks = await downloadAllEnabled(req.user!.id, range, auditCtx(req))
    sendOk(res, {
      message: `已完成 ${tasks.length} 项下载任务`,
      tasks,
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '批量下载失败', 500)
  }
})

downloadRouter.get('/tasks', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100)
  try {
    const tasks = await listRecentTasks(limit)
    sendOk(res, tasks)
  } catch {
    sendFail(res, '获取下载记录失败', 500)
  }
})

downloadRouter.get('/tasks/:id', async (req, res) => {
  try {
    const task = await getTaskById(req.params.id)
    if (!task) {
      sendFail(res, '下载记录不存在', 404)
      return
    }
    sendOk(res, task)
  } catch {
    sendFail(res, '获取下载详情失败', 500)
  }
})

downloadRouter.post('/:type', async (req, res) => {
  const { type } = req.params
  if (!isDownloadType(type)) {
    sendFail(res, '下载类型无效')
    return
  }

  try {
    const needsRange =
      type === 'order' ||
      type === 'live' ||
      type === 'settledSettlement' ||
      type === 'pendingSettlement'
    const range = needsRange
      ? req.body?.startDate && req.body?.endDate
        ? resolveDateRange(
            'custom',
            String(req.body.startDate),
            String(req.body.endDate),
          )
        : parseRange(req)
      : defaultThisMonthRange()
    const task = await downloadByType(
      type,
      req.user!.id,
      needsRange ? range : undefined,
      auditCtx(req),
    )
    const message =
      task.status === 'success' ? '下载成功' : task.errorMessage ?? '下载失败'
    sendOk(res, {
      taskId: task.id,
      status: task.status,
      fileName: task.fileName,
      fileSize: task.fileSize,
      message,
      task,
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '下载失败', 500)
  }
})
