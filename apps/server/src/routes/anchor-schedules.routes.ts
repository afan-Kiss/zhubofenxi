import { Router } from 'express'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import {
  copyDailySchedules,
  generateDefaultSchedulesForDate,
  listDailySchedulesForDate,
  saveDailySchedules,
  setAnchorLeaveForDate,
  validateDailySchedulesBody,
  buildScheduleMutationResult,
  ScheduleSaveError,
} from '../services/anchor-daily-schedule.service'
import {
  confirmDailySchedules,
  getScheduleConfirmStatus,
} from '../services/anchor-schedule-confirm.service'
import { sendFail, sendOk } from '../utils/response'

export const anchorSchedulesRouter = Router()

anchorSchedulesRouter.use(attachRequestUser, requireAuth)

anchorSchedulesRouter.get('/anchor-options', async (req, res, next) => {
  try {
    const date = String(req.query.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date 参数', 400)
      return
    }
    const { listScheduleFormalAnchorOptions } = await import(
      '../services/anchor-date-candidates.service'
    )
    const { isTemporaryAnchorDateAllowed } = await import(
      '../utils/anchor-effective-date.util'
    )
    const options = await listScheduleFormalAnchorOptions(date)
    sendOk(res, {
      date,
      options,
      temporaryAnchorAllowed: isTemporaryAnchorDateAllowed(date),
    })
  } catch (err) {
    next(err)
  }
})

anchorSchedulesRouter.get('/', async (req, res, next) => {
  try {
    const date = String(req.query.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date 参数', 400)
      return
    }
    const data = await listDailySchedulesForDate(date)
    sendOk(res, { ok: true, ...data })
  } catch (err) {
    next(err)
  }
})

anchorSchedulesRouter.post('/generate-default', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const date = String(body.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date', 400)
      return
    }
    const data = await generateDefaultSchedulesForDate({
      date,
      overwrite: Boolean(body.overwrite),
      createdBy: req.user?.username,
      forceHistoricalScheduleChange: Boolean(body.forceHistoricalScheduleChange),
      changeReason: body.changeReason ? String(body.changeReason) : undefined,
    })
    sendOk(res, { ok: true, ...data, ...buildScheduleMutationResult(date) })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '生成默认排班失败', 400)
  }
})

anchorSchedulesRouter.post('/copy', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const fromDate = String(body.fromDate ?? '').trim()
    const toDate = String(body.toDate ?? '').trim()
    if (!fromDate || !toDate) {
      sendFail(res, '请提供 fromDate 与 toDate', 400)
      return
    }
    const data = await copyDailySchedules({
      fromDate,
      toDate,
      createdBy: req.user?.username,
      forceHistoricalScheduleChange: Boolean(body.forceHistoricalScheduleChange),
      changeReason: body.changeReason ? String(body.changeReason) : undefined,
    })
    sendOk(res, { ok: true, ...data, ...buildScheduleMutationResult(toDate) })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '复制排班失败', 400)
  }
})

anchorSchedulesRouter.post('/validate', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const date = String(body.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date', 400)
      return
    }
    const schedules = Array.isArray(body.schedules) ? body.schedules : []
    const result = await validateDailySchedulesBody({
      date,
      schedules,
      allowCrossShopOverlap: Boolean(body.allowCrossShopOverlap),
      changeReason: body.changeReason ? String(body.changeReason) : undefined,
      forConfirm: Boolean(body.forConfirm ?? body.confirm),
    })
    sendOk(res, result)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '校验失败', 400)
  }
})

anchorSchedulesRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const date = String(body.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date', 400)
      return
    }
    const schedules = Array.isArray(body.schedules) ? body.schedules : []
    const data = await saveDailySchedules({
      date,
      schedules,
      createdBy: req.user?.username,
      confirm: Boolean(body.confirm),
      forceHistoricalScheduleChange: Boolean(body.forceHistoricalScheduleChange),
      changeReason: body.changeReason ? String(body.changeReason) : undefined,
      allowCrossShopOverlap: Boolean(body.allowCrossShopOverlap),
    })
    sendOk(res, {
      ok: true,
      ...data,
      ...buildScheduleMutationResult(date, {
        confirmPreviewLines: data.confirmPreviewLines,
        hardValidationWarnings: data.warnings,
      }),
    })
  } catch (err) {
    if (err instanceof ScheduleSaveError) {
      res.status(400).json({
        ok: false,
        success: false,
        message: err.message,
        conflicts: err.conflicts,
      })
      return
    }
    sendFail(res, err instanceof Error ? err.message : '保存排班失败', 400)
  }
})

anchorSchedulesRouter.post('/leave', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const date = String(body.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date', 400)
      return
    }
    if (typeof body.isOnLeave !== 'boolean') {
      sendFail(res, '请提供 isOnLeave（boolean）', 400)
      return
    }
    const data = await setAnchorLeaveForDate({
      date,
      anchorName: body.anchorName ? String(body.anchorName) : null,
      anchorId: body.anchorId ? String(body.anchorId) : null,
      isOnLeave: body.isOnLeave,
      createdBy: req.user?.username,
      forceHistoricalScheduleChange: Boolean(body.forceHistoricalScheduleChange ?? true),
      changeReason: body.changeReason ? String(body.changeReason) : undefined,
    })
    sendOk(res, {
      ok: true,
      ...data,
      ...buildScheduleMutationResult(date, {
        confirmPreviewLines: data.confirmPreviewLines,
        hardValidationWarnings: data.warnings,
      }),
    })
  } catch (err) {
    if (err instanceof ScheduleSaveError) {
      res.status(400).json({
        ok: false,
        success: false,
        message: err.message,
        conflicts: err.conflicts,
      })
      return
    }
    sendFail(res, err instanceof Error ? err.message : '标记休假失败', 400)
  }
})

anchorSchedulesRouter.post('/confirm', async (req, res, next) => {
  try {
    const date = String(req.body?.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date', 400)
      return
    }
    const result = await confirmDailySchedules({
      date,
      confirmedBy: req.user?.username,
      confirmNote: req.body?.confirmNote ? String(req.body.confirmNote) : undefined,
    })
    const schedules = await listDailySchedulesForDate(date)
    sendOk(res, { ok: true, ...result, ...schedules, ...buildScheduleMutationResult(date) })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '确认排班失败', 400)
  }
})

anchorSchedulesRouter.get('/confirm-status', async (req, res, next) => {
  try {
    const date = String(req.query.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date', 400)
      return
    }
    const status = await getScheduleConfirmStatus(date)
    sendOk(res, status)
  } catch (err) {
    next(err)
  }
})
