export const GOOD_REVIEW_MATERIAL_TAG_OPTIONS = [
  '手镯',
  '平安扣',
  '送礼',
  '性价比',
  '颜色好看',
  '细腻',
  '油润',
  '客服服务好',
  '物流快',
  '复购',
  '其他',
] as const

export type GoodReviewMaterialTag = (typeof GOOD_REVIEW_MATERIAL_TAG_OPTIONS)[number]
