import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { sendFail, sendOk } from '../utils/response'
import {
  listCurrentDefaultTemplatesForAdmin,
  saveCurrentDefaultTemplates,
} from '../services/anchor-schedule-template.service'

export const anchorScheduleTemplatesRouter = Router()

anchorScheduleTemplatesRouter.use(attachRequestUser, requireAuth)

/** GET /api/anchor-schedule-templates?date=YYYY-MM-DD — 当日生效的默认排班模板 */
anchorScheduleTemplatesRouter.get('/', async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined
    const data = await listCurrentDefaultTemplatesForAdmin(date)
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '加载默认排班失败', 400)
  }
})

/** PUT /api/anchor-schedule-templates — 保存当日默认排班（主播 / 班次 / 直播间） */
anchorScheduleTemplatesRouter.put('/', async (req, res) => {
  try {
    const body = req.body ?? {}
    const templates = Array.isArray(body.templates) ? body.templates : []
    const data = await saveCurrentDefaultTemplates({
      asOfDate: body.date != null ? String(body.date) : undefined,
      templates: templates.map((t: Record<string, unknown>) => ({
        id: t.id != null ? String(t.id) : undefined,
        anchorId: t.anchorId != null ? String(t.anchorId) : null,
        anchorName: String(t.anchorName ?? ''),
        shopName: String(t.shopName ?? ''),
        liveRoomName: String(t.liveRoomName ?? t.shopName ?? ''),
        startTime: String(t.startTime ?? ''),
        endTime: String(t.endTime ?? ''),
        note: t.note != null ? String(t.note) : null,
        sortOrder: t.sortOrder != null ? Number(t.sortOrder) : undefined,
      })),
    })
    sendOk(res, data)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '保存默认排班失败', 400)
  }
})
