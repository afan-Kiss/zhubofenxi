/** 6.13 起固定场次主播（与后端 ANCHOR_SESSION_DISPLAY_FROM_0613 一致） */
export const FIXED_SESSION_ANCHOR_NAMES = ['子杰', '小红', '飞云', '小艺', '小白'] as const

export type AnchorAssignOption = { id: string; name: string }

/** 合并 API 结果与固定场次主播，保证抽屉下拉始终有 5 人 */
export function mergeAnchorAssignOptions(fromApi: AnchorAssignOption[]): AnchorAssignOption[] {
  const byName = new Map<string, AnchorAssignOption>()
  for (const name of FIXED_SESSION_ANCHOR_NAMES) {
    byName.set(name, { id: `extra-${name}`, name })
  }
  for (const item of fromApi) {
    const name = item.name.trim()
    if (!name || name === '未归属') continue
    byName.set(name, { id: item.id || `extra-${name}`, name })
  }

  const result: AnchorAssignOption[] = []
  const seen = new Set<string>()
  for (const name of FIXED_SESSION_ANCHOR_NAMES) {
    const hit = byName.get(name)
    if (!hit || seen.has(name)) continue
    seen.add(name)
    result.push(hit)
  }
  for (const item of fromApi) {
    const name = item.name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    result.push({ id: item.id || `extra-${name}`, name })
  }
  return result
}
