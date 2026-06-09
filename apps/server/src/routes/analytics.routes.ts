import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import { getClientIp } from '../middleware/audit.middleware'
import { sendFail, sendOk } from '../utils/response'
import {
  buildBuyerRanking,
  type BuyerRankingSortBy,
  type BuyerRankingType,
} from '../services/buyer-ranking.service'
import { loadBuyerRankingWithAutoFill } from '../services/buyer-ranking-fill.service'

export const analyticsRouter = Router()

const SORT_FIELDS: BuyerRankingSortBy[] = [
  'gmv',
  'netGmv',
  'orderCount',
  'refundAmount',
  'refundRate',
  'qualityReturnCount',
  'riskScore',
  'lastOrderTime',
]

const TYPE_VALUES: BuyerRankingType[] = ['all', 'good', 'risk']

const auditCtx = (req: import('express').Request) => ({
  requestId: req.requestId,
  ip: getClientIp(req),
  userAgent: req.headers['user-agent'] ?? undefined,
})

analyticsRouter.use(requireAuth, requireRole('super_admin', 'boss', 'staff'))

analyticsRouter.get('/buyer-ranking', async (req, res) => {
  try {
    const sortByRaw = req.query.sortBy ? String(req.query.sortBy) : 'gmv'
    const sortOrderRaw = req.query.sortOrder ? String(req.query.sortOrder) : 'desc'
    const typeRaw = req.query.type ? String(req.query.type) : 'all'

    if (!SORT_FIELDS.includes(sortByRaw as BuyerRankingSortBy)) {
      sendFail(res, `sortBy 无效，可选：${SORT_FIELDS.join(', ')}`, 400)
      return
    }
    if (sortOrderRaw !== 'asc' && sortOrderRaw !== 'desc') {
      sendFail(res, 'sortOrder 必须为 asc 或 desc', 400)
      return
    }
    if (!TYPE_VALUES.includes(typeRaw as BuyerRankingType)) {
      sendFail(res, `type 无效，可选：${TYPE_VALUES.join(', ')}`, 400)
      return
    }

    const preset = req.query.preset ? String(req.query.preset) : 'today'
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined

    if (preset === 'custom') {
      if (!startDate?.trim() || !endDate?.trim()) {
        sendFail(res, '自定义范围必须提供 startDate 与 endDate', 400)
        return
      }
      if (startDate > endDate) {
        sendFail(res, '开始日期不能晚于结束日期', 400)
        return
      }
    }

    const queryParams = {
      preset,
      startDate,
      endDate,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
      sortBy: sortByRaw as BuyerRankingSortBy,
      sortOrder: sortOrderRaw as 'asc' | 'desc',
      type: typeRaw as BuyerRankingType,
      syncJobId: req.query.syncJobId ? String(req.query.syncJobId) : undefined,
      triggeredBy: req.user?.id ?? null,
      audit: auditCtx(req),
    }

    const autoFill = req.query.autoFill !== '0'
    if (autoFill) {
      const result = await loadBuyerRankingWithAutoFill(queryParams)
      sendOk(res, result)
      return
    }

    const ranking = await buildBuyerRanking(queryParams)
    sendOk(res, { status: 'ready' as const, ranking })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取买家排行失败', 500)
  }
})
