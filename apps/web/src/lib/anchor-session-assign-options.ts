/**
 * 指派下拉排序参考（仅排序，不伪造不存在主播）。
 * 已离职名不要再写进本表；新增主播以 /api 主数据为准。
 */
export const FIXED_SESSION_ANCHOR_NAMES = ['子杰', '橙橙', '飞云', '小白', '小小'] as const

export type AnchorAssignOption = { id: string; name: string }

/** 以 API 选项为准；FIXED 名称仅用于稳定排序 */
export function mergeAnchorAssignOptions(fromApi: AnchorAssignOption[]): AnchorAssignOption[] {
  const byName = new Map<string, AnchorAssignOption>()
  for (const item of fromApi) {
    const name = item.name.trim()
    if (!name || name === '未归属') continue
    byName.set(name, { id: item.id, name })
  }

  const result: AnchorAssignOption[] = []
  const seen = new Set<string>()
  for (const name of FIXED_SESSION_ANCHOR_NAMES) {
    const hit = byName.get(name)
    if (!hit || seen.has(name)) continue
    seen.add(name)
    result.push(hit)
  }
  for (const item of byName.values()) {
    if (seen.has(item.name)) continue
    seen.add(item.name)
    result.push(item)
  }
  return result
}
