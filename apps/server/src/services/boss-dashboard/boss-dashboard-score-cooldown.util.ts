import { formatDateKeyShanghai } from '../../utils/business-timezone'

/** 平台返回旧评分日期时记录，供下一轮经营同步受控重试 */
const staleMarkers = new Map<
  string,
  { shanghaiDay: string; platformScoreDate: string; markedAt: number }
>()

export function markBossShopScoreStale(shopKey: string, platformScoreDate: string): void {
  staleMarkers.set(shopKey, {
    shanghaiDay: formatDateKeyShanghai(),
    platformScoreDate,
    markedAt: Date.now(),
  })
}

export function clearBossShopScoreStale(shopKey: string): void {
  staleMarkers.delete(shopKey)
}

export function shouldBypassBossShopScoreCooldown(shopKey: string): boolean {
  const today = formatDateKeyShanghai()
  const marker = staleMarkers.get(shopKey)
  if (!marker || marker.shanghaiDay !== today) return false
  return true
}

export function resetBossShopScoreStaleForTests(): void {
  staleMarkers.clear()
}
