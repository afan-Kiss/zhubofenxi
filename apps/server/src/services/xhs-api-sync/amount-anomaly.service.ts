import type { NormalizedOrder, SettlementRecord } from '../../types/analysis'
import type { BusinessAnalysisResult } from '../business-analysis.service'
import { centToYuan } from '../../utils/money'

const MAX_SINGLE_ORDER_YUAN = 100_000
const RATIO_THRESHOLD = 2

export interface AmountAnomalyReport {
  warnings: string[]
  hasUnitRisk: boolean
  suspected100xInflated: boolean
  suspected100xDeflated: boolean
}

export function detectAmountAnomalies(
  orders: NormalizedOrder[],
  result: BusinessAnalysisResult,
): AmountAnomalyReport {
  const warnings: string[] = []
  let suspected100xInflated = false
  let suspected100xDeflated = false

  const o = result.overview
  const gmvYuan = centToYuan(o.gmvCent)
  const grossYuan = centToYuan(o.grossProfitCent)
  const settledYuan = centToYuan(o.settledAmountCent)
  const pendingYuan = centToYuan(o.pendingAmountCent)

  if (gmvYuan > 0 && grossYuan > gmvYuan * RATIO_THRESHOLD) {
    warnings.push('毛利润大于 GMV 的 2 倍，疑似金额单位异常')
    suspected100xInflated = true
  }

  if (gmvYuan > 0 && settledYuan + pendingYuan > gmvYuan * RATIO_THRESHOLD) {
    warnings.push('已结算 + 待结算大于 GMV 的 2 倍，疑似结算金额单位异常')
    suspected100xInflated = true
  }

  for (const order of orders) {
    const yuan = order.gmvCent / 100
    if (yuan > MAX_SINGLE_ORDER_YUAN) {
      warnings.push(`单笔订单 ${order.orderId} 金额 ${yuan.toFixed(2)} 元超过 10 万元，请核对`)
      suspected100xInflated = true
    }
  }

  if (orders.length > 0 && gmvYuan > 0) {
    const avgYuan = gmvYuan / orders.length
    if (avgYuan > 50_000) {
      warnings.push('平均订单 GMV 异常偏高，疑似总金额放大 100 倍')
      suspected100xInflated = true
    }
    if (avgYuan > 0 && avgYuan < 0.5 && gmvYuan > 1000) {
      warnings.push('平均订单 GMV 异常偏低，疑似总金额缩小 100 倍')
      suspected100xDeflated = true
    }
  }

  const hasUnitRisk = suspected100xInflated || suspected100xDeflated || warnings.length > 0

  if (hasUnitRisk) {
    warnings.unshift('当前金额可能存在单位异常，请查看数据诊断')
  }

  return { warnings, hasUnitRisk, suspected100xInflated, suspected100xDeflated }
}

export function detectSettlementSampleAnomaly(records: SettlementRecord[]): string[] {
  const warnings: string[] = []
  for (const r of records.slice(0, 20)) {
    const yuan = r.amountCent / 100
    if (yuan > MAX_SINGLE_ORDER_YUAN) {
      warnings.push(`结算记录 ${r.orderId} 金额 ${yuan.toFixed(2)} 元异常`)
    }
  }
  return warnings
}
