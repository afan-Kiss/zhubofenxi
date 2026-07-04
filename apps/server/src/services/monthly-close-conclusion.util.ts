import type { DataAccuracyCheck, DataAccuracyStatus } from './monthly-close-auto.types'

/** check.key → 结论摘要标签（不依赖中文 title） */
const CHECK_REASON_BY_KEY: Record<string, string> = {
  board_vs_daily_sum: '金额差异',
  monthly_close_vs_daily_sum: '月报金额差异',
  ranking_vs_standard_orders: '订单差异',
  bad_buyer_vs_drawer: '售后榜口径不一致',
  buyer_ranking_vs_drawer: '买家榜口径不一致',
  duplicate_orders: '重复订单',
  pay_time_gap: '支付时间漏单风险',
  quality_refund_diagnostic: '品退诊断异常',
}

function isBlockingDangerCheck(c: DataAccuracyCheck): boolean {
  const category = c.category ?? 'blocking'
  return category === 'blocking' && c.status === 'danger'
}

/**
 * 从数据健康 checks 生成结账结论原因摘要（按 key，不按 title 字符串匹配）。
 */
export function buildConclusionReasonSummaryFromChecks(params: {
  checks: DataAccuracyCheck[]
  syncRiskStatus: DataAccuracyStatus
  overallStatus: DataAccuracyStatus
  reconciliationBlockers?: string[]
}): string {
  const parts: string[] = []

  for (const c of params.checks) {
    const label = CHECK_REASON_BY_KEY[c.key]
    if (!label) continue

    if (c.key === 'quality_refund_diagnostic') {
      if (c.status === 'warning' || c.status === 'danger') {
        parts.push(label)
      }
      continue
    }

    if (isBlockingDangerCheck(c)) {
      parts.push(label)
    }
  }

  if (params.syncRiskStatus === 'danger') {
    parts.push('接口风险')
  }

  if (parts.length === 0) {
    if (params.overallStatus === 'pass') return '数据核对通过'
    const blockers = params.reconciliationBlockers?.filter(Boolean) ?? []
    if (blockers.length > 0) {
      return blockers.slice(0, 2).join('；')
    }
    return '存在需关注的提示项'
  }
  return [...new Set(parts)].join('、')
}

/** sectionB 有效成交金额：优先 cent，旧报告才从 yuan 反推 */
export function resolveValidRevenueCentFromSectionB(sectionB: Record<string, unknown>): number {
  const cent = sectionB.validAmountCent
  if (typeof cent === 'number' && Number.isFinite(cent)) {
    return Math.round(cent)
  }
  return Math.round(Number(sectionB.validAmountYuan ?? 0) * 100)
}
