/** 与后端 anchor.service YIFAN_SYSTEM_KEY 对齐：禁止用展示名判断身份 */
export const YIFAN_SYSTEM_KEY = 'YIFAN_MANUAL'

export function isYifanManualSystemAnchor(anchor: {
  systemKey?: string | null
}): boolean {
  return (anchor.systemKey ?? '').trim() === YIFAN_SYSTEM_KEY
}

/** 线下专属主播：不进日报 / 普通直播主播榜 */
export function isOfflineOnlyAnchor(anchor: {
  systemKey?: string | null
}): boolean {
  return isYifanManualSystemAnchor(anchor)
}
