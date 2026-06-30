import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { sendFail, sendOk } from '../utils/response'
import { buildOrderAttributionDebug } from '../services/order-attribution-debug.service'
import { getEffectiveScheduleTablesForRange } from '../services/anchor-daily-schedule.service'

export const anchorPerformanceRouter = Router()

anchorPerformanceRouter.use(attachRequestUser, requireAuth)

anchorPerformanceRouter.get('/effective-schedules', async (req, res) => {
  try {
    const startDate = String(req.query.startDate ?? '').trim()
    const endDate = String(req.query.endDate ?? req.query.startDate ?? '').trim()
    if (!startDate || !endDate) {
      sendFail(res, '请提供 startDate 与 endDate', 400)
      return
    }
    const tables = await getEffectiveScheduleTablesForRange(startDate, endDate)
    sendOk(res, { tables })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '读取生效排班失败', 500)
  }
})

anchorPerformanceRouter.get('/order-attribution-debug', async (req, res) => {
  try {
    const orderNo = String(req.query.orderNo ?? '').trim()
    if (!orderNo) {
      sendFail(res, '请提供 orderNo', 400)
      return
    }
    const data = await buildOrderAttributionDebug(orderNo)
    if (!data.ok) {
      sendFail(res, data.attributionExplain || '未找到订单', 404)
      return
    }
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '归属调试失败', 500)
  }
})
