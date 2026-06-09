import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import { buildRawAnalyzeBundle } from '../services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../services/business-analysis.service'
import {
  computeGrossProfitBreakdown,
  grossProfitToDisplay,
} from '../services/gross-profit.service'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import {
  buildGmvDiagnostics,
  buildGmvOrderDiagnostic,
} from '../services/gmv-diagnostic.service'
import { sendFail, sendOk } from '../utils/response'
import { buildAnomalyData, type AnomalyCategory } from '../services/anomaly-data.service'

export const diagnosticsRouter = Router()

diagnosticsRouter.get(
  '/gmv/order/:packageId',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    try {
      const preset = String(req.query.preset ?? 'today') as DateRangePreset
      const data = await buildGmvOrderDiagnostic(
        String(req.params.packageId),
        preset,
        req.query.startDate ? String(req.query.startDate) : undefined,
        req.query.endDate ? String(req.query.endDate) : undefined,
      )
      sendOk(res, data)
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '订单 GMV 诊断失败', 500)
    }
  },
)

diagnosticsRouter.get('/gmv', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const preset = String(req.query.preset ?? 'today') as DateRangePreset
    const data = await buildGmvDiagnostics(
      preset,
      req.query.startDate ? String(req.query.startDate) : undefined,
      req.query.endDate ? String(req.query.endDate) : undefined,
      req.query.page ? Number(req.query.page) : undefined,
      req.query.pageSize ? Number(req.query.pageSize) : undefined,
    )
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : 'GMV 诊断失败', 500)
  }
})

diagnosticsRouter.get(
  '/gross-profit',
  requireAuth,
  requireRole('super_admin'),
  async (req, res) => {
    try {
      const preset = String(req.query.preset ?? 'thisMonth') as DateRangePreset
      const range = resolveDateRange(
        preset,
        req.query.startDate ? String(req.query.startDate) : undefined,
        req.query.endDate ? String(req.query.endDate) : undefined,
      )

      const bundle = await buildRawAnalyzeBundle(range)
      if (!bundle || !bundle.orders.length) {
        sendOk(res, {
          gmvCent: 0,
          settledIncomeCent: 0,
          pendingIncomeCent: 0,
          refundCent: 0,
          feeCent: 0,
          freightCent: 0,
          grossProfitCent: 0,
          matchedSettlementCount: 0,
          unmatchedSettlementCount: 0,
          nonCurrentSettlementCount: 0,
          duplicateSettlementCount: 0,
          warnings: ['当前范围无订单数据'],
          samples: [],
        })
        return
      }

      const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
      const orderIds = new Set(artifacts.views.map((v) => v.orderId).filter(Boolean))
      const gmvCent = artifacts.views.reduce((s, v) => s + v.gmvCent, 0)
      const breakdown = computeGrossProfitBreakdown(orderIds, gmvCent, artifacts.settlement)
      const display = grossProfitToDisplay(breakdown)

      sendOk(res, {
        ...breakdown,
        formula: display.formula,
        range: { preset, startDate: range.startDate, endDate: range.endDate },
      })
    } catch (err) {
      sendFail(res, err instanceof Error ? err.message : '毛利润诊断失败', 500)
    }
  },
)

diagnosticsRouter.get('/anomalies', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const data = await buildAnomalyData({
      preset: req.query.preset ? String(req.query.preset) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      category: req.query.category ? (String(req.query.category) as AnomalyCategory) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '获取异常数据失败', 500)
  }
})
