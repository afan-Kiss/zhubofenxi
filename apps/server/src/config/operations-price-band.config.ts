/** 运营报表价格带默认档位（元） */
export const OPERATIONS_PRICE_BANDS = [
  { label: '≤399', minYuan: 0, maxYuan: 399 },
  { label: '400~599', minYuan: 400, maxYuan: 599 },
  { label: '600~799', minYuan: 600, maxYuan: 799 },
  { label: '800~999', minYuan: 800, maxYuan: 999 },
  { label: '1000~1299', minYuan: 1000, maxYuan: 1299 },
  { label: '1300~1599', minYuan: 1300, maxYuan: 1599 },
  { label: '1600~1998', minYuan: 1600, maxYuan: 1998 },
  { label: '1999+', minYuan: 1999, maxYuan: null },
] as const

export type OperationsPriceBandLabel = (typeof OPERATIONS_PRICE_BANDS)[number]['label']

function yuanToCent(yuan: number): number {
  return Math.round(yuan * 100)
}

/** maxYuan=1998 表示至 1998.99 元（199899 分） */
function bandMinCent(minYuan: number): number {
  return minYuan * 100
}

function bandMaxCent(maxYuan: number): number {
  return maxYuan * 100 + 99
}

/** 按支付金额（分）解析价格带标签 */
export function resolvePriceBandLabelFromCent(cent: number): OperationsPriceBandLabel {
  if (!Number.isFinite(cent) || cent < 0) return '≤399'
  for (const band of OPERATIONS_PRICE_BANDS) {
    const minCent = bandMinCent(band.minYuan)
    if (band.maxYuan == null) {
      if (cent >= minCent) return band.label
      continue
    }
    const maxCent = bandMaxCent(band.maxYuan)
    if (cent >= minCent && cent <= maxCent) return band.label
  }
  return '1999+'
}

/** 按支付金额（元）解析价格带标签 */
export function resolvePriceBandLabel(yuan: number): OperationsPriceBandLabel {
  return resolvePriceBandLabelFromCent(yuanToCent(yuan))
}
