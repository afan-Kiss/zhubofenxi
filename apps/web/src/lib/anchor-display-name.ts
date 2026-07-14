/** 后端/内部口径：未匹配主播 */
export const UNASSIGNED_ANCHOR_INTERNAL = '未归属'

/**
 * 用户可见口径：归属失败（禁止再显示为「自然流散客」——那会掩盖数据质量问题）
 */
export const UNASSIGNED_ANCHOR_DISPLAY = '未归属（需核对）'

export const UNASSIGNED_ANCHOR_HINT =
  '这些订单未成功匹配主播，请检查下单时间、直播号、真实场次和历史排班。'

export function isUnassignedAnchorName(name: string | null | undefined): boolean {
  const trimmed = String(name ?? '').trim()
  return (
    !trimmed ||
    trimmed === UNASSIGNED_ANCHOR_INTERNAL ||
    trimmed === UNASSIGNED_ANCHOR_DISPLAY ||
    trimmed === '自然流散客'
  )
}

/** 将内部主播名转为页面展示文案 */
export function formatAnchorDisplayName(name: string | null | undefined): string {
  if (isUnassignedAnchorName(name)) return UNASSIGNED_ANCHOR_DISPLAY
  return String(name).trim()
}
