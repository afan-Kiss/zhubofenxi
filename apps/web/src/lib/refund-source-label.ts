import { displayCell } from './board-order-row'

/** 买家 Drawer / 经营明细：退款数据来源 → 中文说明（禁止展示内部英文 code） */
const REFUND_SOURCE_LABELS: Record<string, string> = {
  after_sales_workbench: '售后工作台',
  after_sales_workbench_expected: '售后工作台（预计）',
  after_sales_workbench_applied: '售后工作台',
  after_sales_workbench_pending: '待同步',
  after_sales_workbench_no_record: '售后工作台（无记录）',
  after_sales_workbench_zero_refund: '售后工作台（零退款）',
  no_after_sale: '无售后',
  none: '无售后',
  settlement: '结算明细',
  raw_product_refund: '订单售后字段',
  raw_refund_amount: '订单退款字段',
  raw_after_sale_refund: '订单售后退款字段',
  capped_to_payment: '按支付金额封顶',
  order_closed_after_sale_complete: '订单关闭且售后完成',
}

export function formatRefundSourceLabel(
  source: string | undefined,
  pending: boolean,
  sourceText?: string | null,
): string {
  if (pending) return '待同步'
  const text = (sourceText ?? '').trim()
  if (text && text !== '—') return text
  const key = (source ?? '').trim()
  if (!key) return '—'
  if (REFUND_SOURCE_LABELS[key]) return REFUND_SOURCE_LABELS[key]!
  if (key.startsWith('raw_')) return '订单原始字段'
  return '—'
}

/** @deprecated 使用 formatRefundSourceLabel */
export function refundSourceLabel(source: string | undefined, pending: boolean): string {
  return formatRefundSourceLabel(source, pending)
}
