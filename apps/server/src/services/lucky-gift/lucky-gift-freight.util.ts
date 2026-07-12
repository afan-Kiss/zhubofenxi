/** 福袋名称是否已含运费说明，避免重复标签 */

const FREIGHT_KEYWORDS = ['运费自理', '到付', '运费到付', '邮费自理', '邮费到付']

export function giftNameImpliesCollectFreight(giftName: string | null | undefined): boolean {
  const name = String(giftName || '')
  return FREIGHT_KEYWORDS.some((k) => name.includes(k))
}

export function resolveFreightLabelForDisplay(giftName: string | null | undefined): string | null {
  if (giftNameImpliesCollectFreight(giftName)) return null
  return '到付'
}

export function resolveFreightForCopy(giftName: string | null | undefined): string {
  if (giftNameImpliesCollectFreight(giftName)) {
    const name = String(giftName || '')
    if (name.includes('到付')) return '到付'
    return '运费自理'
  }
  return '到付'
}
