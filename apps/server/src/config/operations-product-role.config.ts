/** 商品角色自动分类阈值（可配置常量） */
export const OPERATIONS_PRODUCT_ROLE_THRESHOLDS = {
  /** 热卖：成交件数 ≥ 此值 */
  hotSaleMinSoldCount: 5,
  /** 潜力：成交件数 ≥ 此值且退货率 < hotReturnRateMax */
  potentialMinSoldCount: 2,
  potentialMaxReturnRate: 0.15,
  /** 滞销：成交件数 ≤ 此值 */
  slowMovingMaxSoldCount: 1,
  /** 高退货风险：退货率 ≥ 此值且成交件数 ≥ 此值 */
  highReturnRateMin: 0.3,
  highReturnMinSoldCount: 2,
} as const

export type OperationsProductRole =
  | 'hot_sale'
  | 'potential'
  | 'slow_moving'
  | 'high_return_risk'
  | 'normal'

export const OPERATIONS_PRODUCT_ROLE_LABELS: Record<OperationsProductRole, string> = {
  hot_sale: '爆款',
  potential: '潜力款',
  slow_moving: '滞销款',
  high_return_risk: '高退货风险',
  normal: '常规',
}

/** 人工 productRole 优先于自动分类 */
export function resolveProductRole(params: {
  soldCount: number
  returnRate: number | null
  manualRole?: string | null
}): OperationsProductRole {
  const manual = normalizeManualRole(params.manualRole)
  if (manual) return manual

  const { soldCount, returnRate } = params
  const t = OPERATIONS_PRODUCT_ROLE_THRESHOLDS
  const rate = returnRate ?? 0

  if (soldCount >= t.hotSaleMinSoldCount && rate < t.potentialMaxReturnRate) {
    return 'hot_sale'
  }
  if (
    soldCount >= t.highReturnMinSoldCount &&
    rate >= t.highReturnRateMin
  ) {
    return 'high_return_risk'
  }
  if (soldCount <= t.slowMovingMaxSoldCount) {
    return 'slow_moving'
  }
  if (
    soldCount >= t.potentialMinSoldCount &&
    rate < t.potentialMaxReturnRate
  ) {
    return 'potential'
  }
  return 'normal'
}

function normalizeManualRole(raw?: string | null): OperationsProductRole | null {
  if (!raw?.trim()) return null
  const v = raw.trim()
  if (v === 'hot_sale' || v === '爆款') return 'hot_sale'
  if (v === 'potential' || v === '潜力款') return 'potential'
  if (v === 'slow_moving' || v === '滞销款') return 'slow_moving'
  if (v === 'high_return_risk' || v === '高退货风险') return 'high_return_risk'
  if (v === 'normal' || v === '常规') return 'normal'
  return null
}

export function productRoleLabel(role: OperationsProductRole): string {
  return OPERATIONS_PRODUCT_ROLE_LABELS[role]
}
