import type { DashboardOverviewResponse } from './dashboard-api.service'
import { TRUST_STATUS_HINTS } from '../types/data-validation'
import type { AnalysisTrustStatus } from '../types/data-validation'

function fmtMoney(yuan: number): string {
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

function trustStatusText(status: AnalysisTrustStatus | string): string {
  if (status === 'official_ready') return '可正式汇报'
  if (status === 'preview_only') return '仅供预览'
  if (status === 'blocked') return '数据异常，禁止汇报'
  return '分析异常'
}

export function buildReportSummaryText(
  dashboard: DashboardOverviewResponse & { startDate?: string; endDate?: string },
): string {
  const status = dashboard.trust.status
  const riskLine =
    status === 'preview_only' || status === 'blocked' || status === 'error'
      ? '\n\n⚠️ 当前数据存在风险，不建议直接作为正式汇报。'
      : ''

  const lines: string[] = [
    '本次直播经营数据汇总：',
    `时间范围：${dashboard.startDate ?? '—'} 至 ${dashboard.endDate ?? '—'}`,
    `数据状态：${trustStatusText(status)}`,
    '',
    `总GMV：${fmtMoney(dashboard.gmv)}`,
    `总订单数：${dashboard.orderCount}单`,
    `实际签收：${dashboard.actualSignedCount}单`,
    `实际签收金额：${fmtMoney(dashboard.actualSignedAmount)}`,
    `退货：${dashboard.returnCount}单`,
    `退货率：${fmtRate(dashboard.returnRate)}`,
    `品退：${dashboard.qualityReturnCount}单`,
    `品退金额：${fmtMoney(dashboard.qualityReturnAmount)}`,
    `已结算：${fmtMoney(dashboard.settledAmount)}`,
    `待结算：${fmtMoney(dashboard.pendingAmount)}`,
    '',
  ]

  for (const a of dashboard.anchorSummaries) {
    lines.push(
      `${a.anchorName}：`,
      `GMV：${fmtMoney(a.gmv)}`,
      `订单：${a.orderCount}单`,
      `实际签收：${a.actualSignedCount}单`,
      `退货率：${fmtRate(a.returnRate)}`,
      `品退：${a.qualityReturnCount}单`,
      `品退金额：${fmtMoney(a.qualityReturnAmount)}`,
      '',
    )
  }

  lines.push(
    '风险提醒：',
    `未归属订单：${dashboard.unassignedOrderCount}单`,
    `异常订单：${dashboard.abnormalOrderCount}单`,
    `数据状态：${dashboard.trust.statusLabel}`,
  )

  if (dashboard.trust.riskHints.length > 0) {
    lines.push(`补充：${dashboard.trust.riskHints.slice(0, 3).join('；')}`)
  }

  if (status === 'preview_only') {
    lines.push(TRUST_STATUS_HINTS.preview_only)
  }
  if (status === 'blocked') {
    lines.push(TRUST_STATUS_HINTS.blocked)
  }

  return lines.join('\n') + riskLine
}
