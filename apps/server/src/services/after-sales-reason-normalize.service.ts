export type AfterSalesReasonCategory =
  | 'size_mismatch'
  | 'quality_issue'
  | 'description_mismatch'
  | 'shipping_damage'
  | 'wrong_item'
  | 'change_mind'
  | 'logistics_delay'
  | 'other'

export const AFTER_SALES_REASON_LABELS: Record<AfterSalesReasonCategory, string> = {
  size_mismatch: '尺寸不符',
  quality_issue: '质量问题',
  description_mismatch: '描述不符',
  shipping_damage: '运输损坏',
  wrong_item: '发错货',
  change_mind: '不想要了',
  logistics_delay: '物流问题',
  other: '其他',
}

const REASON_RULES: Array<{ category: AfterSalesReasonCategory; keywords: string[] }> = [
  { category: 'size_mismatch', keywords: ['尺寸', '圈口', '大小', '偏大', '偏小', '不合适'] },
  { category: 'quality_issue', keywords: ['质量', '瑕疵', '破损', '断裂', '掉色', '品退'] },
  { category: 'description_mismatch', keywords: ['描述', '不符', '色差', '实物'] },
  { category: 'shipping_damage', keywords: ['运输', '快递', '损坏', '碎'] },
  { category: 'wrong_item', keywords: ['发错', '错发', '漏发'] },
  { category: 'change_mind', keywords: ['不想要', '买错', '七天', '无理由'] },
  { category: 'logistics_delay', keywords: ['物流', '超时', '未收到', '丢件'] },
]

export function normalizeAfterSalesReason(rawReason: string): {
  rawReason: string
  category: AfterSalesReasonCategory
  categoryLabel: string
} {
  const text = (rawReason ?? '').trim()
  if (!text) {
    return { rawReason: text, category: 'other', categoryLabel: AFTER_SALES_REASON_LABELS.other }
  }
  for (const rule of REASON_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) {
      return {
        rawReason: text,
        category: rule.category,
        categoryLabel: AFTER_SALES_REASON_LABELS[rule.category],
      }
    }
  }
  return { rawReason: text, category: 'other', categoryLabel: AFTER_SALES_REASON_LABELS.other }
}

export interface AfterSalesReasonRow {
  category: AfterSalesReasonCategory
  categoryLabel: string
  orderCount: number
  refundAmountYuan: number
  sharePercent: number | null
}

export function aggregateAfterSalesReasons(
  items: Array<{ rawReason: string; refundAmountCent: number; orderKey: string }>,
): AfterSalesReasonRow[] {
  const byCategory = new Map<
    AfterSalesReasonCategory,
    { orderKeys: Set<string>; refundAmountCent: number }
  >()
  for (const item of items) {
    const normalized = normalizeAfterSalesReason(item.rawReason)
    const bucket = byCategory.get(normalized.category) ?? {
      orderKeys: new Set<string>(),
      refundAmountCent: 0,
    }
    bucket.orderKeys.add(item.orderKey)
    bucket.refundAmountCent += item.refundAmountCent
    byCategory.set(normalized.category, bucket)
  }
  const totalOrders = new Set(items.map((i) => i.orderKey)).size
  const rows: AfterSalesReasonRow[] = []
  for (const [category, bucket] of byCategory.entries()) {
    rows.push({
      category,
      categoryLabel: AFTER_SALES_REASON_LABELS[category],
      orderCount: bucket.orderKeys.size,
      refundAmountYuan: Math.round(bucket.refundAmountCent / 100),
      sharePercent:
        totalOrders > 0 ? Math.round((bucket.orderKeys.size / totalOrders) * 100) : null,
    })
  }
  return rows.sort((a, b) => b.orderCount - a.orderCount)
}
