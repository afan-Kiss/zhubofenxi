/** 后端/内部口径：未匹配主播 */
export const UNASSIGNED_ANCHOR_INTERNAL = '未归属'

/** 用户可见口径：未匹配主播 */
export const UNASSIGNED_ANCHOR_DISPLAY = '自然流散客'

export function isUnassignedAnchorName(name: string | null | undefined): boolean {
  const trimmed = String(name ?? '').trim()
  return !trimmed || trimmed === UNASSIGNED_ANCHOR_INTERNAL
}

/** 将内部主播名转为页面展示文案 */
export function formatAnchorDisplayName(name: string | null | undefined): string {
  if (isUnassignedAnchorName(name)) return UNASSIGNED_ANCHOR_DISPLAY
  return String(name).trim()
}
