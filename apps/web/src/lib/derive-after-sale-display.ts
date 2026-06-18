import type { BoardDrillOrderRow } from './board-order-row'

export type AfterSaleDisplayTone = 'none' | 'pending' | 'success' | 'closed' | 'quality'

export interface AfterSaleDisplay {
  hasEffectiveAfterSale: boolean
  label: string
  tone: AfterSaleDisplayTone
}

export type BuyerOrderRowExt = BoardDrillOrderRow & {
  orderStatusLabel?: string
  afterSaleStatusLabel?: string
  afterSaleDisplayTone?: AfterSaleDisplayTone
  hasEffectiveAfterSale?: boolean
  payTime?: string | null
  signTime?: string | null
  afterSaleApplyTime?: string | null
  afterSaleCompleteTime?: string | null
  netDealAmount?: number
  afterSaleNo?: string | null
  refundSourceText?: string | null
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true
  const s = String(v).trim()
  return !s || s === '—'
}

export function deriveAfterSaleDisplay(row: BuyerOrderRowExt): AfterSaleDisplay {
  if (row.afterSaleStatusLabel) {
    return {
      hasEffectiveAfterSale: row.hasEffectiveAfterSale ?? false,
      label: row.afterSaleStatusLabel,
      tone: row.afterSaleDisplayTone ?? 'none',
    }
  }

  const refund = Number(row.refundAmount ?? row.productRefundAmount ?? 0)
  const refundSource = row.refundAmountSource ?? ''
  const reasonEmpty = isEmpty(row.afterSaleReason) && isEmpty(row.afterSaleReasonText)
  const typeEmpty = isEmpty(row.afterSaleStatus) && isEmpty(row.afterSaleDisplayType)
  const noSource = !refundSource || refundSource === 'no_after_sale'

  if (refund > 0) {
    return row.isQualityReturn
      ? { hasEffectiveAfterSale: true, label: '商品问题售后', tone: 'quality' }
      : { hasEffectiveAfterSale: true, label: '已退款', tone: 'success' }
  }
  if (row.refundAmountPending) {
    return { hasEffectiveAfterSale: true, label: '售后中', tone: 'pending' }
  }
  if (refund === 0 && typeEmpty && reasonEmpty && noSource) {
    return { hasEffectiveAfterSale: false, label: '无售后', tone: 'none' }
  }
  return { hasEffectiveAfterSale: false, label: '无售后', tone: 'none' }
}

export function orderStatusLabelForRow(row: BuyerOrderRowExt): string {
  if (row.orderStatusLabel && row.orderStatusLabel !== '—') return row.orderStatusLabel
  return isEmpty(row.orderStatus) ? '—' : String(row.orderStatus)
}

export function netDealAmountForRow(row: BuyerOrderRowExt): number {
  return earnedAmountForRow(row)
}

export function earnedAmountForRow(row: BuyerOrderRowExt): number {
  if (row.earnedAmount != null && Number.isFinite(row.earnedAmount)) {
    return Math.max(0, row.earnedAmount)
  }
  if (row.netDealAmount != null && Number.isFinite(row.netDealAmount)) {
    return Math.max(0, row.netDealAmount)
  }
  return 0
}

export function warnBuyerOrderAnomalies(
  row: BuyerOrderRowExt,
  opts?: { headerRefundOrderCount?: number },
): void {
  if (!import.meta.env.DEV) return

  const display = deriveAfterSaleDisplay(row)
  const refund = Number(row.refundAmount ?? row.productRefundAmount ?? 0)
  const refundSource = row.refundAmountSource ?? ''
  const reasonEmpty = isEmpty(row.afterSaleReason) && isEmpty(row.afterSaleReasonText)
  const typeEmpty = isEmpty(row.afterSaleStatus) && isEmpty(row.afterSaleDisplayType)
  const orderNo = row.orderNo

  if (
    display.hasEffectiveAfterSale &&
    display.label !== '售后中' &&
    (refundSource === 'no_after_sale' || refundSource === 'after_sales_workbench_no_record')
  ) {
    console.warn('[buyer-order-anomaly] 售后标签与退款来源矛盾', { orderNo, display, refundSource })
  }

  if (
    display.hasEffectiveAfterSale &&
    display.label !== '售后中' &&
    typeEmpty &&
    reasonEmpty &&
    refund <= 0
  ) {
    console.warn('[buyer-order-anomaly] 有售后标签但类型/原因为空', { orderNo, display })
  }

  if (opts?.headerRefundOrderCount != null && refund <= 0 && display.label === '已退款') {
    console.warn('[buyer-order-anomaly] 卡片显示退款但明细金额为 0', { orderNo })
  }
}

export function afterSaleToneClass(tone: AfterSaleDisplayTone): string {
  switch (tone) {
    case 'quality':
      return 'bg-rose-100 text-rose-700'
    case 'success':
      return 'bg-amber-100 text-amber-800'
    case 'pending':
      return 'bg-sky-100 text-sky-800'
    case 'closed':
      return 'bg-slate-100 text-slate-500'
    default:
      return 'bg-slate-50 text-slate-500'
  }
}
