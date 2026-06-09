export type AppPageScope = 'overview' | 'anchors' | 'buyers' | 'settings' | 'other'

export function resolveAppPageScope(pathname: string): AppPageScope {
  if (pathname === '/' || pathname === '') return 'overview'
  if (pathname.startsWith('/anchors')) return 'anchors'
  if (pathname.startsWith('/buyers')) return 'buyers'
  if (pathname.startsWith('/settings')) return 'settings'
  return 'other'
}
