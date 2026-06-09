import type { AnalyzedOrderView } from '../types/analysis'
import { viewCountsAsPaidOrder, viewInvolvesRefundAfterSale } from './business-metrics.service'
import {
  calcOrderRate,
  calcRefundRate,
  resolveMetricOrderNo,
  warnIfRefundOrderCountExceedsPaid,
  type RefundRateWarnContext,
} from './calc-refund-rate.service'
import {
  resolveViewRefundAmountCent,
  viewCountsAsRefundOrder,
} from './order-refund-metrics.service'
import { isEffectiveSignedView, isStrictQualityRefundView } from './strict-after-sale-metrics.service'
import { viewCountsAsQualityRefund } from './quality-refund-resolution.service'
import type { NormalizedQualityBadCase } from './quality-badcase.types'
import { getOfficialQualityPackageIdSet } from './quality-badcase-store.service'

export interface OrderMetricSets {
  paidOrderNos: string[]
  refundOrderNos: string[]
  returnRefundOrderNos: string[]
  qualityRefundOrderNos: string[]
  signedOrderNos: string[]
  afterSaleRecordCount: number
  paidOrderCount: number
  refundOrderCount: number
  returnOrderCount: number
  qualityRefundOrderCount: number
  signedOrderCount: number
  refundRate: number | null
  returnRate: number | null
  qualityRefundRate: number | null
  signRate: number | null
}

export function buildOrderMetricSets(
  views: AnalyzedOrderView[],
  warnCtx?: RefundRateWarnContext,
  officialCases?: NormalizedQualityBadCase[],
): OrderMetricSets {
  const officialPackageIds = officialCases?.length
    ? getOfficialQualityPackageIdSet(officialCases)
    : undefined
  const paidOrderNos: string[] = []
  const refundOrderNos: string[] = []
  const returnRefundOrderNos: string[] = []
  const qualityRefundOrderNos: string[] = []
  const signedOrderNos: string[] = []
  let afterSaleRecordCount = 0

  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    const paid = viewCountsAsPaidOrder(v)

    if (paid && no) paidOrderNos.push(no)

    if (viewInvolvesRefundAfterSale(v)) {
      afterSaleRecordCount += 1
    }

    if (viewCountsAsRefundOrder(v) && no) {
      refundOrderNos.push(no)
    }

    if (paid && viewCountsAsRefundOrder(v) && v.isReturnRefundOrder && no) {
      returnRefundOrderNos.push(no)
    }

    if (paid && viewCountsAsQualityRefund(v, officialPackageIds) && no) {
      qualityRefundOrderNos.push(no)
    }

    if (isEffectiveSignedView(v) && paid && no) {
      signedOrderNos.push(no)
    }
  }

  const refundResult = calcRefundRate({ paidOrderNos, refundOrderNos })
  const returnResult = calcOrderRate({
    paidOrderNos,
    numeratorOrderNos: returnRefundOrderNos,
  })
  const qualityResult = calcOrderRate({
    paidOrderNos,
    numeratorOrderNos: qualityRefundOrderNos,
  })
  const signResult = calcOrderRate({
    paidOrderNos,
    numeratorOrderNos: signedOrderNos,
  })

  if (warnCtx) {
    warnIfRefundOrderCountExceedsPaid(refundResult, warnCtx)
    if (refundResult.refundOrderCount > 0) {
      const allZero = views
        .filter((v) => viewCountsAsRefundOrder(v))
        .every((v) => resolveViewRefundAmountCent(v) <= 0)
      if (allZero) {
        console.warn(
          `[refund-rate] 存在退款订单数但退款金额为0 scope=${warnCtx.scope}`,
        )
      }
    }
    if (
      refundResult.refundOrderCount === refundResult.paidOrderCount &&
      refundResult.paidOrderCount > 0 &&
      signResult.numeratorOrderCount === 0
    ) {
      console.warn(
        `[refund-rate] 退款订单数等于支付订单数且签收为0 scope=${warnCtx.scope} ` +
          `anchor=${warnCtx.anchorName ?? ''}`,
      )
    }
  }

  return {
    paidOrderNos,
    refundOrderNos,
    returnRefundOrderNos,
    qualityRefundOrderNos,
    signedOrderNos,
    afterSaleRecordCount,
    paidOrderCount: refundResult.paidOrderCount,
    refundOrderCount: refundResult.refundOrderCount,
    returnOrderCount: returnResult.numeratorOrderCount,
    qualityRefundOrderCount: qualityResult.numeratorOrderCount,
    signedOrderCount: signResult.numeratorOrderCount,
    refundRate: refundResult.refundRate,
    returnRate: returnResult.rate,
    qualityRefundRate: qualityResult.rate,
    signRate: signResult.rate,
  }
}
