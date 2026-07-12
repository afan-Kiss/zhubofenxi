import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../providers/AuthProvider'
import { PAGE_PERMISSION_ROUTES, type PagePermissionKey } from '../../lib/page-permissions'

function routePermission(pathname: string): PagePermissionKey | null {
  if (pathname === '/' || pathname.startsWith('/?')) return 'overview'
  if (pathname.startsWith('/anchors')) return 'anchors'
  if (pathname.startsWith('/buyers')) return 'buyers'
  if (pathname.startsWith('/lucky-gifts')) return 'lucky_gifts'
  if (pathname.startsWith('/operations-report')) return 'operations_report'
  if (pathname.startsWith('/good-reviews')) return 'good_reviews'
  if (pathname.startsWith('/boss-dashboard')) return 'boss_dashboard'
  if (pathname.startsWith('/settings')) return 'settings'
  return null
}

export const RequireAuth: React.FC = () => {
  const { loading, user, mode, canAccess } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        正在加载…
      </div>
    )
  }

  if (mode === 'session' && !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  const perm = routePermission(location.pathname)
  if (perm && !canAccess(perm)) {
    const fallback =
      (Object.entries(PAGE_PERMISSION_ROUTES).find(([key]) =>
        canAccess(key as PagePermissionKey),
      )?.[1] as string | undefined) ?? '/login'
    return <Navigate to={fallback} replace />
  }

  return <Outlet />
}
