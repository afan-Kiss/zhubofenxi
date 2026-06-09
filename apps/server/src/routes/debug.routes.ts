import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import { sendFail, sendOk } from '../utils/response'
import { buildAmountCheckReport } from '../services/amount-check.service'
import { buildBoardCheckExportBuffer } from '../services/board-check-export.service'
import {
  importLatestOrderQueryExcelFromRealTableDir,
  importXhsOrderQueryExcel,
} from '../services/xhs-excel-order-import.service'
import { normalizeBoardPreset } from '../services/board-metrics.service'
import { resolveDateRange } from '../utils/date-range'

export const debugRouter = Router()

debugRouter.use(requireAuth, requireRole('super_admin'))

debugRouter.get('/amount-check', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : ''
    const endDate = req.query.endDate ? String(req.query.endDate) : ''
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate（YYYY-MM-DD）', 400)
      return
    }
    if (startDate > endDate) {
      sendFail(res, '开始日期不能晚于结束日期', 400)
      return
    }
    const page = req.query.page ? Number(req.query.page) : 1
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 100
    const data = await buildAmountCheckReport(startDate, endDate, page, pageSize)
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '金额核对失败', 500)
  }
})

debugRouter.get('/export-board-check', async (req, res) => {
  try {
    const preset = String(req.query.preset ?? 'thisMonth')
    const normalized = normalizeBoardPreset(preset)
    const range = resolveDateRange(
      normalized,
      req.query.startDate ? String(req.query.startDate) : undefined,
      req.query.endDate ? String(req.query.endDate) : undefined,
    )
    const { buffer, filename } = await buildBoardCheckExportBuffer({
      preset,
      startDate: range.startDate,
      endDate: range.endDate,
      username: req.user?.username,
    })
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    )
    res.send(buffer)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '导出核对表失败', 500)
  }
})

debugRouter.post('/import-order-excel', async (req, res) => {
  try {
    const relativePath = req.body?.relativePath
      ? String(req.body.relativePath)
      : undefined
    const result = relativePath
      ? await importXhsOrderQueryExcel(relativePath)
      : await importLatestOrderQueryExcelFromRealTableDir()
    sendOk(res, result)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '导入订单 Excel 失败', 500)
  }
})
