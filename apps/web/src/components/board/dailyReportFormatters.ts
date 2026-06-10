import type { DailyReportPayload } from './DailyReportImageSheet'

export function formatMoney(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatIntegerMoney(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}`
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '--'
  const m = Math.round(minutes)
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h > 0 && min > 0) return `${h}小时${min}分`
  if (h > 0) return `${h}小时`
  return `${min}分钟`
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '--'
  return `${Math.round(ratio)}%`
}

export function formatDensity(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '--'
  return `${Math.round(minutes)}分钟/单`
}

export function formatHourly(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '--'
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}/小时`
}

export function formatOrderCount(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return '--'
  return `${Math.round(count)}单`
}

export function buildChatGptDailyReportPrompt(data: DailyReportPayload): string {
  const anchorBlocks = data.anchors
    .map((row, index) => {
      return [
        `${index + 1}. ${row.anchorName}`,
        `- 场次：${row.sessionLabel}`,
        `- 直播时间：${row.livePeriodText}`,
        `- 直播时长：${row.liveDurationText}`,
        `- 真实发货金额：${formatMoney(row.shippedAmountYuan)}`,
        `- 真实卖出单数：${formatOrderCount(row.soldOrderCount)}`,
        `- 客单价：${formatIntegerMoney(row.avgOrderAmountYuan)}`,
        `- 时均产出：${formatHourly(row.hourlyAmountYuan)}`,
        `- 成交密度：${formatDensity(row.dealDensityMinutes)}`,
        `- 异常单：${formatOrderCount(row.invalidOrderCount)}`,
        `- 金额占比：${formatPercent(row.amountRatio)}`,
      ].join('\n')
    })
    .join('\n\n')

  return [
    '请根据下面的主播日报数据，帮我生成“AI建议”。',
    '',
    '要求：',
    '1. 只输出 2~3 条建议。',
    '2. 每条一句话。',
    '3. 用老板能看懂的大白话。',
    '4. 不要重新计算金额。',
    '5. 不要编造主播名字。',
    '6. 不要编造订单数据。',
    '7. 不要输出长篇报告。',
    '8. 重点分析：谁卖得多、谁效率高、谁异常单多、谁需要优化直播节奏。',
    '9. 输出格式直接用：',
    'AI建议：',
    '1. ...',
    '2. ...',
    '3. ...',
    '',
    `日期：${data.startDate}`,
    '',
    '总览：',
    `- 真实发货金额：${formatMoney(data.summary.totalShippedAmountYuan)}`,
    `- 真实卖出单数：${formatOrderCount(data.summary.totalSoldOrderCount)}`,
    `- 直播总时长：${formatDuration(data.summary.totalLiveDurationMinutes)}`,
    `- 整体时均产出：${formatHourly(data.summary.overallHourlyAmountYuan)}`,
    `- 异常单：${formatOrderCount(data.summary.totalInvalidOrderCount)}`,
    '',
    '主播明细：',
    anchorBlocks,
    '',
    '数据说明：',
    '- 真实卖出单不包含已关闭订单、售后完成订单、低价刷单。',
    '- 异常单 = 已关闭订单 + 售后完成订单。',
    '- 发货金额沿用系统主播业绩页口径。',
  ].join('\n')
}

/** 解析用户粘贴的 AI 建议，最多 3 条 */
export function normalizeAiSuggestionText(raw: string): string[] {
  const text = raw.trim()
  if (!text) return []

  let body = text.replace(/^AI建议[:：]?\s*/i, '').trim()
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const items: string[] = []
  for (const line of lines) {
    const matched = line.match(/^(?:\d+[.、)]\s*|[-•*]\s*)?(.+)$/)
    const content = (matched?.[1] ?? line).trim()
    if (content) items.push(content)
    if (items.length >= 3) break
  }

  if (items.length === 0 && body) {
    return [body.slice(0, 200)]
  }
  return items.slice(0, 3)
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fallback below
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
