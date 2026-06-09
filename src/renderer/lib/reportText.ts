import type { BusinessAnalysisResult } from '../types/business'
import { formatCentToMoney, formatRate } from './businessAnalyzer'

export function buildReportText(result: BusinessAnalysisResult): string {
  const o = result.overview
  const month = result.month || '当月'
  const lines = [
    `【${month} 直播订单经营汇报】`,
    `GMV：${formatCentToMoney(o.gmvCent)}（按下单时间）`,
    `订单数：${o.orderCount}`,
    `实际签收：${o.actualSignedCount} 单 / ${formatCentToMoney(o.actualSignedAmountCent)}`,
    `退货：${o.returnCount} 单 / ${formatCentToMoney(o.returnAmountCent)}（退货率 ${formatRate(o.returnRate)}）`,
    `品退：${o.qualityReturnCount} 单 / ${formatCentToMoney(o.qualityReturnAmountCent)}（品退率 ${formatRate(o.qualityReturnRate)}）`,
    `已结算：${formatCentToMoney(o.settledAmountCent)} · 待结算：${formatCentToMoney(o.pendingAmountCent)}`,
    `经营毛利：${formatCentToMoney(o.grossProfitCent)}（${o.grossProfitNote}）`,
  ]

  if (result.anchorSummaries.length) {
    lines.push('', '【主播】')
    for (const a of result.anchorSummaries) {
      lines.push(
        `${a.anchorName}：GMV ${formatCentToMoney(a.gmvCent)}（${formatRate(a.gmvShare)}）· 签收 ${a.actualSignedCount} 单 · 退货率 ${formatRate(a.returnRate)}`,
      )
    }
  }

  if (result.warnings.length) {
    lines.push('', '【提示】', ...result.warnings.map((w) => `· ${w}`))
  }

  return lines.join('\n')
}
