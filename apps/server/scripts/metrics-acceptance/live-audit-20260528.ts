/**
 * 2026-05-28 live 库自洽审计：API summary ↔ pipeline 计算 ↔ 订单/退款不变量
 */
import path from 'node:path'
import { config } from 'dotenv'
import { resolveDateRange } from '../../src/utils/date-range'
import { buildRawAnalyzeBundle } from '../../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../../src/services/business-analysis.service'
import {
  calculateBusinessMetrics,
  viewCountsAsPaidOrder,
} from '../../src/services/business-metrics.service'
import { resolveMetricOrderNo } from '../../src/services/calc-refund-rate.service'
import {
  aggregateRefundAmountCentByOrderNo,
  resolveViewRefundAmountCent,
} from '../../src/services/order-refund-metrics.service'
import { hasOrderPaymentTime, isOrderUnpaid } from '../../src/services/order-amount-metrics.service'
import { centToYuan } from '../../src/utils/money'
import { refreshAnchorConfigCache } from '../../src/services/anchor.service'
import { bootstrapQualityBadCaseCache } from '../../src/services/quality-badcase-store.service'
import { moneyClose } from './assertions'
import { GOLDEN_DATE } from './golden-cases'

config({ path: path.resolve(__dirname, '../../.env') })

export interface Live20260528AuditResult {
  date: string
  api: { paidAmount: number; paidOrders: number; refundAmount: number } | null
  pipeline: { paidAmount: number; paidOrders: number; refundAmount: number }
  anchorSubtotals: {
    子杰: { paidOrders: number; paidAmount: number }
    飞云: { paidOrders: number; paidAmount: number }
    other: { paidOrders: number; paidAmount: number }
  }
  violations: string[]
  paidOrderNos: string[]
}

function anchorBucket(name: string | undefined): '子杰' | '飞云' | 'other' {
  const n = String(name ?? '').trim()
  if (n === '子杰') return '子杰'
  if (n === '飞云') return '飞云'
  return 'other'
}

export async function auditLive20260528(
  apiSummary?: Record<string, unknown> | null,
): Promise<Live20260528AuditResult> {
  await refreshAnchorConfigCache()
  await bootstrapQualityBadCaseCache()

  const range = resolveDateRange('custom', GOLDEN_DATE, GOLDEN_DATE)
  const violations: string[] = []

  const bundle = await buildRawAnalyzeBundle(range)
  if (!bundle) {
    violations.push('live 库在 2026-05-28 无订单 bundle')
    return {
      date: GOLDEN_DATE,
      api: apiSummary
        ? {
            paidAmount: Number(apiSummary.totalGmv ?? 0),
            paidOrders: Number(apiSummary.orderCount ?? 0),
            refundAmount: Number(apiSummary.returnAmount ?? 0),
          }
        : null,
      pipeline: { paidAmount: 0, paidOrders: 0, refundAmount: 0 },
      anchorSubtotals: {
        子杰: { paidOrders: 0, paidAmount: 0 },
        飞云: { paidOrders: 0, paidAmount: 0 },
        other: { paidOrders: 0, paidAmount: 0 },
      },
      violations,
      paidOrderNos: [],
    }
  }

  const art = prepareAnalysisArtifactsFromRaw(bundle, { statRange: range })
  const views = art.views
  const metrics = calculateBusinessMetrics(views)
  const paidViews = views.filter(viewCountsAsPaidOrder)

  const paidOrderNos: string[] = []
  const seenOrderNo = new Set<string>()
  const anchorSubtotals = {
    子杰: { paidOrders: 0, paidAmount: 0 },
    飞云: { paidOrders: 0, paidAmount: 0 },
    other: { paidOrders: 0, paidAmount: 0 },
  }

  for (const v of paidViews) {
    const no = resolveMetricOrderNo(v)
    if (!no) {
      violations.push('存在已计入支付但缺少 P 订单号的 view')
      continue
    }
    if (!/^P/i.test(no)) {
      violations.push(`非 P 开头订单被计入支付: ${no}`)
    }
    if (seenOrderNo.has(no)) {
      violations.push(`orderNo 重复计数: ${no}`)
    }
    seenOrderNo.add(no)
    paidOrderNos.push(no)

    const order = bundle.orders.find(
      (o) =>
        o.displayOrderNo === no ||
        o.officialOrderNo === no ||
        o.packageId === no,
    )
    if (order) {
      if (!hasOrderPaymentTime(order)) {
        violations.push(`无 payTime 订单被计入: ${no}`)
      }
      if (isOrderUnpaid(order)) {
        violations.push(`未支付订单被计入: ${no}`)
      }
    }

    const bucket = anchorBucket(v.anchorName)
    anchorSubtotals[bucket].paidOrders += 1
    anchorSubtotals[bucket].paidAmount += v.paymentBaseCent / 100
  }

  if (paidViews.length !== seenOrderNo.size) {
    violations.push(
      `支付订单 view 行数(${paidViews.length})与唯一 orderNo 数(${seenOrderNo.size})不一致`,
    )
  }

  const { totalCent: refundCent } = aggregateRefundAmountCentByOrderNo(views)
  const pipelineRefundYuan = centToYuan(refundCent)
  if (!moneyClose(metrics.refundAmount, pipelineRefundYuan)) {
    violations.push(
      `pipeline 退款金额不一致: calculateBusinessMetrics=${metrics.refundAmount} aggregate=${pipelineRefundYuan}`,
    )
  }

  for (const v of paidViews) {
    const refund = resolveViewRefundAmountCent(v)
    if (refund < 0) {
      violations.push(`退款金额为负: ${resolveMetricOrderNo(v)}`)
    }
  }

  const pipeline = {
    paidAmount: metrics.totalGmv,
    paidOrders: metrics.orderCount,
    refundAmount: metrics.refundAmount,
  }

  const api = apiSummary
    ? {
        paidAmount: Number(apiSummary.totalGmv ?? apiSummary.gmv ?? 0),
        paidOrders: Number(apiSummary.orderCount ?? apiSummary.paidOrderCount ?? 0),
        refundAmount: Number(
          apiSummary.returnAmount ?? apiSummary.productRefundAmount ?? 0,
        ),
      }
    : null

  if (api) {
    if (!moneyClose(api.paidAmount, pipeline.paidAmount)) {
      violations.push(
        `API 与 pipeline 支付金额不一致: api=${api.paidAmount} pipeline=${pipeline.paidAmount}`,
      )
    }
    if (api.paidOrders !== pipeline.paidOrders) {
      violations.push(
        `API 与 pipeline 支付订单数不一致: api=${api.paidOrders} pipeline=${pipeline.paidOrders}`,
      )
    }
    if (!moneyClose(api.refundAmount, pipeline.refundAmount)) {
      violations.push(
        `API 与 pipeline 退款金额不一致: api=${api.refundAmount} pipeline=${pipeline.refundAmount}`,
      )
    }
  }

  paidOrderNos.sort()

  return {
    date: GOLDEN_DATE,
    api,
    pipeline,
    anchorSubtotals,
    violations,
    paidOrderNos,
  }
}
