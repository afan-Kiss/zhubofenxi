import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { sendFail, sendOk } from '../utils/response'
import {
  createOfflineDeal,
  listOfflineDealAudit,
  listOfflineDeals,
  reassignOfflineDeal,
  updateOfflineDealStatus,
} from '../services/offline-deal.service'
import { listOrderAnchorAssignOptions } from '../services/order-anchor-manual-override.service'
import { getAnchorConfigSync, refreshAnchorConfigCache } from '../services/anchor.service'

export const offlineDealRouter = Router()

offlineDealRouter.use(attachRequestUser, requireAuth)

offlineDealRouter.get('/anchor-options', async (_req, res) => {
  try {
    await refreshAnchorConfigCache()
    const config = getAnchorConfigSync()
    const anchors = config.anchors
      .filter((a) => a.enabled)
      .map((a) => ({
        id: a.id,
        name: a.name,
        attributionMode: a.attributionMode ?? 'schedule',
        systemKey: a.systemKey ?? null,
        label: `${a.name}｜${a.attributionMode === 'manual' ? '仅手动归属' : '自动归属'}`,
      }))
    // 补充固定场次主播（API 选项与手动指定共用）
    const assign = await listOrderAnchorAssignOptions()
    const byName = new Map(anchors.map((a) => [a.name, a]))
    for (const item of assign) {
      if (byName.has(item.name)) continue
      byName.set(item.name, {
        id: item.id,
        name: item.name,
        attributionMode: item.attributionMode === 'manual' ? 'manual' : 'schedule',
        systemKey: item.systemKey ?? null,
        label: `${item.name}｜${item.attributionMode === 'manual' ? '仅手动归属' : '自动归属'}`,
      })
    }
    sendOk(res, { anchors: [...byName.values()] })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取主播选项失败', 500)
  }
})

offlineDealRouter.get('/', async (req, res) => {
  try {
    const data = await listOfflineDeals({
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      anchorName: req.query.anchorName ? String(req.query.anchorName) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      pendingOnly:
        req.query.pendingOnly === '1' ||
        req.query.pendingOnly === 'true' ||
        req.query.pendingAttribution === '1',
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '查询线下成交失败', 500)
  }
})

offlineDealRouter.post('/', async (req, res) => {
  try {
    const body = req.body ?? {}
    const created = await createOfflineDeal({
      amountYuan: Number(body.amountYuan ?? body.amount),
      dealAt: body.dealAt ?? body.dealTime,
      anchorId: body.anchorId != null ? String(body.anchorId) : undefined,
      anchorName: body.anchorName != null ? String(body.anchorName) : undefined,
      customerLabel: body.customerLabel != null ? String(body.customerLabel) : undefined,
      note: body.note != null ? String(body.note) : undefined,
      externalKey: body.externalKey != null ? String(body.externalKey) : undefined,
      idempotencyKey: body.idempotencyKey != null ? String(body.idempotencyKey) : undefined,
      status: body.status != null ? String(body.status) : 'confirmed',
      allowPending:
        body.allowPending === true ||
        body.allowPending === '1' ||
        body.pendingAttribution === true,
      operator: req.user!.username,
    })
    const amountText = created.amountYuan.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    const tip = created.pendingAttribution
      ? `已录入线下成交 ¥${amountText}，待归属主播`
      : `已录入线下成交 ¥${amountText}，归属于${created.anchorName}`
    sendOk(res, { ...created, message: tip })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '录入线下成交失败', 400)
  }
})

offlineDealRouter.post('/:id/reassign', async (req, res) => {
  try {
    const result = await reassignOfflineDeal({
      dealId: req.params.id,
      anchorId: req.body?.anchorId != null ? String(req.body.anchorId) : undefined,
      anchorName: req.body?.anchorName != null ? String(req.body.anchorName) : undefined,
      operator: req.user!.username,
      reason: req.body?.reason != null ? String(req.body.reason) : undefined,
    })
    sendOk(res, result)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '修改归属失败', 400)
  }
})

offlineDealRouter.post('/:id/status', async (req, res) => {
  try {
    const result = await updateOfflineDealStatus({
      dealId: req.params.id,
      status: String(req.body?.status ?? ''),
      refundYuan: req.body?.refundYuan != null ? Number(req.body.refundYuan) : undefined,
      operator: req.user!.username,
      reason: req.body?.reason != null ? String(req.body.reason) : undefined,
    })
    sendOk(res, result)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '更新状态失败', 400)
  }
})

offlineDealRouter.get('/:id/audit', async (req, res) => {
  try {
    sendOk(res, { items: await listOfflineDealAudit(req.params.id) })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '查询审计失败', 500)
  }
})
