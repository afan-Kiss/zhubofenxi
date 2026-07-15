import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import {
  createAnchor,
  disableAnchor,
  listAnchorFilterOptions,
  listAnchorsForAdmin,
  reorderAnchors,
  softDeleteAnchor,
  updateAnchor,
} from '../services/anchor.service'
import { sendFail, sendOk } from '../utils/response'
import { buildAnchorMetricDetail } from '../services/anchor-metric-detail.service'
import type { AnchorMetricType } from '../services/anchor-metric-detail.service'

export const anchorRouter = Router()

anchorRouter.use(attachRequestUser, requireAuth)

anchorRouter.get('/options', async (_req, res) => {
  try {
    const data = await listAnchorFilterOptions()
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取主播选项失败', 500)
  }
})

anchorRouter.get('/', async (req, res) => {
  try {
    const includeDeleted = req.query.includeDeleted === '1'
    const list = await listAnchorsForAdmin(includeDeleted)
    sendOk(res, list)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取主播列表失败', 500)
  }
})

anchorRouter.post('/', async (req, res) => {
  try {
    const body = req.body ?? {}
    const anchor = await createAnchor({
      name: String(body.name ?? ''),
      externalId: body.externalId != null ? String(body.externalId) : undefined,
      defaultLiveRoomName:
        body.defaultLiveRoomName != null ? String(body.defaultLiveRoomName) : undefined,
      color: body.color ? String(body.color) : undefined,
      sortOrder: body.sortOrder != null ? Number(body.sortOrder) : undefined,
      manualOnly: body.manualOnly === true || body.manualOnly === '1' || body.manualOnly === 1,
      timeRules: Array.isArray(body.timeRules) ? body.timeRules : undefined,
      attributionMode:
        body.attributionMode === 'manual' || body.attributionMode === 'schedule'
          ? body.attributionMode
          : undefined,
      effectiveFrom: body.effectiveFrom != null ? String(body.effectiveFrom) : undefined,
      effectiveTo: body.effectiveTo != null ? String(body.effectiveTo) : undefined,
    })
    sendOk(res, anchor)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '新增主播失败', 400)
  }
})

anchorRouter.get(
  '/:anchorId/metric-detail',
  async (req, res) => {
    try {
      const metric = String(req.query.metric ?? '') as AnchorMetricType
      if (metric !== 'qualityRefundRate' && metric !== 'signRate') {
        sendFail(res, 'metric 必须为 qualityRefundRate 或 signRate', 400)
        return
      }
      const startDate = req.query.startDate ? String(req.query.startDate) : ''
      const endDate = req.query.endDate ? String(req.query.endDate) : ''
      if (!startDate || !endDate) {
        sendFail(res, '请提供 startDate 与 endDate', 400)
        return
      }
      const data = await buildAnchorMetricDetail({
        anchorId: req.params.anchorId!,
        metric,
        startDate,
        endDate,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
        tab: req.query.tab ? String(req.query.tab) : undefined,
        sort: req.query.sort ? String(req.query.sort) : undefined,
        afterSaleType: req.query.afterSaleType ? String(req.query.afterSaleType) : undefined,
        role: req.user!.role as import('../types/roles').UserRole,
        username: req.user!.username,
      })
      sendOk(res, data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取指标明细失败'
      sendFail(res, msg, /无权/.test(msg) ? 403 : 500)
    }
  },
)

anchorRouter.post('/reorder', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : []
    const list = await reorderAnchors(ids)
    sendOk(res, list)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '排序失败', 400)
  }
})

anchorRouter.patch('/:id', async (req, res) => {
  try {
    const anchor = await updateAnchor(req.params.id, {
      name: req.body?.name != null ? String(req.body.name) : undefined,
      externalId:
        req.body?.externalId !== undefined
          ? req.body.externalId == null
            ? null
            : String(req.body.externalId)
          : undefined,
      defaultLiveRoomName:
        req.body?.defaultLiveRoomName !== undefined
          ? req.body.defaultLiveRoomName == null
            ? null
            : String(req.body.defaultLiveRoomName)
          : undefined,
      color: req.body?.color != null ? String(req.body.color) : undefined,
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : undefined,
      sortOrder: req.body?.sortOrder != null ? Number(req.body.sortOrder) : undefined,
      attributionMode:
        req.body?.attributionMode === 'manual' || req.body?.attributionMode === 'schedule'
          ? req.body.attributionMode
          : undefined,
      effectiveFrom:
        req.body?.effectiveFrom !== undefined
          ? req.body.effectiveFrom == null
            ? null
            : String(req.body.effectiveFrom)
          : undefined,
      effectiveTo:
        req.body?.effectiveTo !== undefined
          ? req.body.effectiveTo == null
            ? null
            : String(req.body.effectiveTo)
          : undefined,
      timeRules: Array.isArray(req.body?.timeRules) ? req.body.timeRules : undefined,
    })
    sendOk(res, anchor)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '更新主播失败', 400)
  }
})

anchorRouter.post('/:id/disable', async (req, res) => {
  try {
    const anchor = await disableAnchor(req.params.id)
    sendOk(res, anchor)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '停用主播失败', 400)
  }
})

anchorRouter.post('/:id/delete', async (req, res) => {
  try {
    const result = await softDeleteAnchor(req.params.id)
    sendOk(res, result)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '删除主播失败', 400)
  }
})
