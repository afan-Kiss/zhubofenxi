import cron from 'node-cron'
import { formatDateKeyShanghai, shanghaiDateParts } from '../utils/business-timezone'
import { resolveAutoCloseTargetMonth, runMonthlyCloseAuto } from './monthly-close-auto.service'
import { hasSuccessfulMonthlyCloseReport } from './monthly-close-report-store.service'
import { logInfo, logWarn } from '../utils/server-log'

const TIMEZONE = 'Asia/Shanghai'
const AUTO_CLOSE_CRON = '30 3 15 * *'
const CATCHUP_MAX_DAY = 20

let cronTask: cron.ScheduledTask | null = null
let catchupChecked = false

async function maybeRunAutoClose(force = false): Promise<void> {
  const now = new Date()
  const targetMonth = resolveAutoCloseTargetMonth(now)
  if (!targetMonth) return

  if (!force && (await hasSuccessfulMonthlyCloseReport(targetMonth))) {
    logInfo('月度结账调度', `${targetMonth} 已有成功报告，跳过`)
    return
  }

  try {
    await runMonthlyCloseAuto({ month: targetMonth, force })
  } catch (err) {
    logWarn(
      '月度结账调度',
      `执行失败：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function runCatchupIfNeeded(): Promise<void> {
  if (catchupChecked) return
  catchupChecked = true

  const now = new Date()
  const { day } = shanghaiDateParts(now)
  if (day < 16 || day > CATCHUP_MAX_DAY) return

  const targetMonth = resolveAutoCloseTargetMonth(now)
  if (!targetMonth) return

  if (await hasSuccessfulMonthlyCloseReport(targetMonth)) return

  logInfo(
    '月度结账调度',
    `补跑 ${targetMonth}（${formatDateKeyShanghai(now)}，错过 15 号定时任务）`,
  )
  await maybeRunAutoClose(true)
}

export function initMonthlyCloseScheduler(): void {
  if (cronTask) return

  cronTask = cron.schedule(
    AUTO_CLOSE_CRON,
    () => {
      void maybeRunAutoClose(false)
    },
    { timezone: TIMEZONE },
  )

  void runCatchupIfNeeded()

  logInfo('月度结账调度', `已注册：每月 15 日 03:30（${TIMEZONE}）`)
}
