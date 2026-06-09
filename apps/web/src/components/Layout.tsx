import React, { useCallback, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Menu, Settings, Users, UserCircle, X } from 'lucide-react'
import { PageRequestStatusBar } from './board/PageRequestStatusBar'
import { CookieHealthWatcher } from './board/CookieHealthWatcher'
import { BoardLiveQueryProvider } from '../providers/BoardLiveQueryProvider'
import { PageTransition } from './ui/PageTransition'
import { MainNavTabs } from './ui/MainNavTabs'
import { SettingsPasswordDialog } from './settings/SettingsPasswordDialog'
import { isSettingsUnlocked, unlockSettings } from '../lib/settings-gate'

const MAIN_NAV = [
  { to: '/', end: true, label: (<><LayoutDashboard size={14} /> 经营总览</>), dataTestId: 'tab-overview' },
  { to: '/anchors', label: (<><UserCircle size={14} /> 主播业绩</>), dataTestId: 'tab-anchors' },
  { to: '/buyers', label: (<><Users size={14} /> 买家排行</>), dataTestId: 'tab-buyers' },
  { to: '/settings', label: (<><Settings size={14} /> 系统设置</>), dataTestId: 'tab-settings', requiresUnlock: true },
]

export const Layout: React.FC = () => {
  const [navOpen, setNavOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const handleNavAttempt = useCallback(
    (to: string): boolean => {
      if (to !== '/settings') return true
      if (isSettingsUnlocked()) return true
      setSettingsDialogOpen(true)
      return false
    },
    [],
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

  return (
    <div className="flex min-h-screen min-w-0 flex-col">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-[var(--color-bg-warm)]/90 backdrop-blur-md transition-shadow duration-300">
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between md:gap-4 md:px-4">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-900">本地经营看板</h1>
              <p className="mt-0.5 text-[11px] text-slate-500">当前展示本地已同步数据</p>
            </div>
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-rose-50 md:hidden"
              onClick={() => setNavOpen((v) => !v)}
              aria-label={navOpen ? '关闭菜单' : '打开菜单'}
            >
              {navOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>

          <nav
            className={`min-w-0 overflow-hidden rounded-2xl bg-white/50 p-1.5 transition-all duration-300 ease-out md:block ${
              navOpen
                ? 'max-h-[320px] opacity-100'
                : 'max-h-0 opacity-0 md:max-h-none md:opacity-100'
            } ${navOpen ? 'block' : 'hidden md:block'}`}
          >
            <MainNavTabs
              items={MAIN_NAV}
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
