export interface CoverageSumResult {
  valueCent: number | null
  complete: boolean
  coveredShopCount: number
  requiredShopCount: number
  missingShopKeys: string[]
  staleShopKeys: string[]
  partialValueCent: number | null
}

export function sumWithCoverage(
  entries: Array<{ shopKey: string; valueCent: number | null | undefined; stale?: boolean }>,
  requiredShopKeys: readonly string[],
): CoverageSumResult {
  const byShop = new Map(entries.map((e) => [e.shopKey, e]))
  const missingShopKeys: string[] = []
  const staleShopKeys: string[] = []
  let partialSum = 0
  let hasAny = false

  for (const shopKey of requiredShopKeys) {
    const entry = byShop.get(shopKey)
    if (entry?.valueCent == null) {
      missingShopKeys.push(shopKey)
      continue
    }
    if (entry.stale) staleShopKeys.push(shopKey)
    partialSum += entry.valueCent
    hasAny = true
  }

  const complete = missingShopKeys.length === 0 && staleShopKeys.length === 0

  return {
    valueCent: complete ? partialSum : null,
    complete,
    coveredShopCount: requiredShopKeys.length - missingShopKeys.length,
    requiredShopCount: requiredShopKeys.length,
    missingShopKeys,
    staleShopKeys,
    partialValueCent: hasAny ? partialSum : null,
  }
}

export function sumCompleteOrNull(
  entries: Array<{ shopKey: string; valueCent: number | null | undefined; stale?: boolean }>,
  requiredShopKeys: readonly string[],
): number | null {
  return sumWithCoverage(entries, requiredShopKeys).valueCent
}
