/** 运营报表价格带默认档位（元） */
export const OPERATIONS_PRICE_BANDS = [
  { label: '≤399', minYuan: 0, maxYuan: 399 },
  { label: '400~599', minYuan: 400, maxYuan: 599 },
  { label: '600~799', minYuan: 600, maxYuan: 799 },
  { label: '800~999', minYuan: 800, maxYuan: 999 },
  { label: '1000~1299', minYuan: 1000, maxYuan: 1299 },
  { label: '1300~1599', minYuan: 1300, maxYuan: 1599 },
  { label: '1600~1999', minYuan: 1600, maxYuan: 1999 },
  { label: '1999+', minYuan: 2000, maxYuan: null },
] as const

export type OperationsPriceBandLabel = (typeof OPERATIONS_PRICE_BANDS)[number]['label']

/** 按支付金额（元）解析价格带标签 */
export function resolvePriceBandLabel(yuan: number): OperationsPriceBandLabel {
  if (!Number.isFinite(yuan) || yuan < 0) return '≤399'
  for (const band of OPERATIONS_PRICE_BANDS) {
    if (band.maxYuan == null) {
      if (yuan >= band.minYuan) return band.label
      continue
    }
    if (yuan >= band.minYuan && yuan <= band.maxYuan) return band.label
  }
  return '1999+'
}

export function resolvePriceBandLabelFromCent(cent: number): OperationsPriceBandLabel {
  return resolvePriceBandLabel(cent / 100)
}
