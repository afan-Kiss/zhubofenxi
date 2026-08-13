export type AppPageScope = 'overview' | 'anchors' | 'buyers' | 'settings' | 'other'

export function resolveAppPageScope(pathname: string): AppPageScope {
  // `/` 会重定向到主播业绩
  if (pathname === '/' || pathname === '' || pathname.startsWith('/anchors')) return 'anchors'
  if (pathname.startsWith('/overview')) return 'overview'
  if (pathname.startsWith('/buyers')) return 'buyers'
  if (pathname.startsWith('/settings')) return 'settings'
  return 'other'
}
