/**
 * 订单列表售后信号三态判断（纯函数，可单测）
 * 仅依据 afterSaleStatus / afterSaleStatusDesc / firstAfterSaleStatus / secondAfterSaleStatus
 */
export type AfterSaleSignal = 'HAS_AFTER_SALE' | 'NO_AFTER_SALE' | 'UNKNOWN'

export interface BatchOrderPackage {
  packageId?: string | null
  orderId?: string | null
  afterSaleStatus?: number | string | null
  afterSaleStatusDesc?: string | null
  firstAfterSaleStatus?: number | string | null
  secondAfterSaleStatus?: number | string | null
}

function toFiniteNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

export function resolveAfterSaleSignal(pkg: BatchOrderPackage): AfterSaleSignal {
  const status = toFiniteNumber(pkg.afterSaleStatus)
  const firstStatus = toFiniteNumber(pkg.firstAfterSaleStatus)
  const secondStatus = toFiniteNumber(pkg.secondAfterSaleStatus)
  const desc = String(pkg.afterSaleStatusDesc ?? '').trim()

  const hasPositiveSignal =
    status === 2 ||
    status === 3 ||
    firstStatus === 2 ||
    firstStatus === 3 ||
    (secondStatus != null && secondStatus > 0) ||
    (desc.includes('售后') && desc !== '无售后')

  const hasNegativeSignal = status === 1 || desc === '无售后'

  if (hasPositiveSignal && hasNegativeSignal) return 'UNKNOWN'
  if (hasPositiveSignal) return 'HAS_AFTER_SALE'
  if (hasNegativeSignal) return 'NO_AFTER_SALE'
  return 'UNKNOWN'
}

export function packageFromUnknown(raw: unknown): BatchOrderPackage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const packageId =
    r.packageId != null
      ? String(r.packageId).trim()
      : r.package_id != null
        ? String(r.package_id).trim()
        : null
  const orderId =
    r.orderId != null
      ? String(r.orderId).trim()
      : r.order_id != null
        ? String(r.order_id).trim()
        : null
  return {
    packageId: packageId || null,
    orderId: orderId || null,
    afterSaleStatus: (r.afterSaleStatus ?? r.after_sale_status) as number | string | null,
    afterSaleStatusDesc: (r.afterSaleStatusDesc ?? r.after_sale_status_desc) as string | null,
    firstAfterSaleStatus: (r.firstAfterSaleStatus ?? r.first_after_sale_status) as
      | number
      | string
      | null,
    secondAfterSaleStatus: (r.secondAfterSaleStatus ?? r.second_after_sale_status) as
      | number
      | string
      | null,
  }
}
