import React, { useCallback, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Menu, Settings, Users, UserCircle, X, FileText, LogOut, ThumbsUp } from 'lucide-react'
import { PageRequestStatusBar } from './board/PageRequestStatusBar'
import { CookieHealthWatcher } from './board/CookieHealthWatcher'
import { BoardLiveQueryProvider } from '../providers/BoardLiveQueryProvider'
import { PageTransition } from './ui/PageTransition'
import { MainNavTabs } from './ui/MainNavTabs'
import { SettingsPasswordDialog } from './settings/SettingsPasswordDialog'
import { isSettingsUnlocked, unlockSettings } from '../lib/settings-gate'
import { useAuth } from '../providers/AuthProvider'
import type { PagePermissionKey } from '../lib/page-permissions'

const ALL_NAV: Array<{
  to: string
  end?: boolean
  label: React.ReactNode
  dataTestId: string
  permission: PagePermissionKey
  requiresUnlock?: boolean
}> = [
  {
    to: '/',
    end: true,
    label: (<><LayoutDashboard size={14} /> 经营总览</>),
    dataTestId: 'tab-overview',
    permission: 'overview',
  },
  {
    to: '/anchors',
    label: (<><UserCircle size={14} /> 主播业绩</>),
    dataTestId: 'tab-anchors',
    permission: 'anchors',
  },
  {
    to: '/buyers',
    label: (<><Users size={14} /> 买家排行</>),
    dataTestId: 'tab-buyers',
    permission: 'buyers',
  },
  {
    to: '/operations-report',
    label: (<><FileText size={14} /> 运营报表</>),
    dataTestId: 'tab-operations-report',
    permission: 'operations_report',
  },
  {
    to: '/good-reviews',
    label: (<><ThumbsUp size={14} /> 好评中心</>),
    dataTestId: 'tab-good-reviews',
    permission: 'good_reviews',
  },
  {
    to: '/settings',
    label: (<><Settings size={14} /> 系统设置</>),
    dataTestId: 'tab-settings',
    permission: 'settings',
    requiresUnlock: true,
  },
]

export const Layout: React.FC = () => {
  const [navOpen, setNavOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { user, mode, canAccess, logout } = useAuth()

  const mainNav = useMemo(
    () => ALL_NAV.filter((item) => canAccess(item.permission)),
    [canAccess],
  )

  const handleNavAttempt = useCallback(
    (to: string): boolean => {
      if (to !== '/settings') return true
      if (mode === 'session' && canAccess('settings')) return true
      if (isSettingsUnlocked()) return true
      setSettingsDialogOpen(true)
      return false
    },
    [canAccess, mode],
  )

  const handleSettingsVerified = useCallback(() => {
    unlockSettings()
    setSettingsDialogOpen(false)
    navigate('/settings')
    setNavOpen(false)
  }, [navigate])

  const handleSettingsCancel = useCallback(() => {
    setSettingsDialogOpen(false)
    if (location.pathname === '/settings') {
      navigate('/')
    }
  }, [location.pathname, navigate])

  const handleLogout = useCallback(() => {
    void logout().then(() => {
      if (mode === 'session') navigate('/login', { replace: true })
    })
  }, [logout, mode, navigate])

  return (
    <div className="flex min-h-screen min-w-0 flex-col">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-[var(--color-bg-warm)]/90 backdrop-blur-md transition-shadow duration-300">
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between md:gap-4 md:px-4">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-900">直播经营看板</h1>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {user ? `${user.username}${user.role === 'super_admin' ? ' · 管理员' : ''}` : '经营数据展示'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {mode === 'session' && user ? (
                <button
                  type="button"
                  className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-rose-50 md:inline-flex md:items-center md:gap-1"
                  onClick={() => void handleLogout()}
                >
                  <LogOut size={14} /> 退出
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-rose-50 md:hidden"
                onClick={() => setNavOpen((v) => !v)}
                aria-label={navOpen ? '关闭菜单' : '打开菜单'}
              >
                {navOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </div>

          <nav
            className={`min-w-0 overflow-hidden rounded-2xl bg-white/50 p-1.5 transition-all duration-300 ease-out md:block ${
              navOpen
                ? 'max-h-[320px] opacity-100'
                : 'max-h-0 opacity-0 md:max-h-none md:opacity-100'
            } ${navOpen ? 'block' : 'hidden md:block'}`}
          >
            <MainNavTabs
              items={mainNav}
              onNavigate={() => setNavOpen(false)}
              onBeforeNavigate={handleNavAttempt}
            />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-3 py-4 md:px-4">
        <BoardLiveQueryProvider>
          <CookieHealthWatcher />
          <PageRequestStatusBar />
          <PageTransition>
            <Outlet />
          </PageTransition>
        </BoardLiveQueryProvider>
      </main>

      <SettingsPasswordDialog
        open={settingsDialogOpen}
        onVerified={handleSettingsVerified}
        onCancel={handleSettingsCancel}
      />
    </div>
  )
}
