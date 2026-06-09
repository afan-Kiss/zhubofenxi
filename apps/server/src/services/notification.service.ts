import { writeOperationLog } from './audit.service'
import { getNotificationSettings } from './system-setting.service'

/** 微信机器人等通知渠道预留；当前仅日志输出 */
export async function sendDailySummary(rangeLabel: string): Promise<void> {
  const settings = await getNotificationSettings()
  const enabled = settings.notificationEnabled
  const channel = settings.notificationChannel

  const text = `[notification] 经营看板已改为实时查询，范围：${rangeLabel}。请在页面选择日期后查看 live-query 数据。`

  await writeOperationLog({
    action: 'notification_summary_preview',
    module: 'system',
    description: '日报通知预览（未实际发送）',
    meta: { rangeLabel, channel, enabled },
  })

  console.log(`[notification] enabled=${enabled} channel=${channel} range=${rangeLabel}`)
  console.log(`[notification] preview:\n${text}`)
}
