import React, { useCallback, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Settings,
  Users,
  UserCircle,
  FileText,
  LogOut,
  ThumbsUp,
  Briefcase,
  Gift,
  MessageSquareWarning,
} from 'lucide-react'
import { PageRequestStatusBar } from './board/PageRequestStatusBar'
import { CookieHealthWatcher } from './board/CookieHealthWatcher'
import { BoardLiveQueryProvider } from '../providers/BoardLiveQueryProvider'
import { BossDashboardProvider } from '../providers/BossDashboardProvider'
import { BossAnnouncementCenter } from './boss/BossAnnouncementCenter'
import { PageTransition } from './ui/PageTransition'
import { MainNavTabs } from './ui/MainNavTabs'
import { SettingsPasswordDialog } from './settings/SettingsPasswordDialog'
import { isSettingsUnlocked, unlockSettings } from '../lib/settings-gate'
import { useAuth } from '../providers/AuthProvider'
import type { PagePermissionKey } from '../lib/page-permissions'
import type { LucideIcon } from 'lucide-react'

const ALL_NAV: Array<{
  to: string
  end?: boolean
  label: string
  icon: LucideIcon
  dataTestId: string
  permission: PagePermissionKey
  tone?: 'default' | 'muted'
}> = [
  {
    to: '/',
    end: true,
    label: '经营总览',
    icon: LayoutDashboard,
    dataTestId: 'tab-overview',
    permission: 'overview',
  },
  {
    to: '/anchors',
    label: '主播业绩',
    icon: UserCircle,
    dataTestId: 'tab-anchors',
    permission: 'anchors',
  },
  {
    to: '/buyers',
    label: '买家榜单',
    icon: Users,
    dataTestId: 'tab-buyers',
    permission: 'buyers',
  },
  {
    to: '/lucky-gifts',
    label: '福袋发货',
    icon: Gift,
    dataTestId: 'tab-lucky-gifts',
    permission: 'lucky_gifts',
  },
  {
    to: '/data-health',
    label: '数据健康',
    icon: FileText,
    dataTestId: 'tab-data-health',
    permission: 'operations_report',
  },
  {
    to: '/operations-report',
    label: '运营报表',
    icon: FileText,
    dataTestId: 'tab-operations-report',
    permission: 'operations_report',
  },
  {
    to: '/good-reviews',
    label: '好评中心',
    icon: ThumbsUp,
    dataTestId: 'tab-good-reviews',
    permission: 'good_reviews',
  },
  {
    to: '/refund-analysis',
    label: '退款分析',
    icon: MessageSquareWarning,
    dataTestId: 'tab-refund-analysis',
    permission: 'refund_analysis',
  },
  {
    to: '/boss-dashboard',
    label: '老板查看',
    icon: Briefcase,
    dataTestId: 'tab-boss-dashboard',
    permission: 'boss_dashboard',
  },
  {
    to: '/settings',
    label: '系统设置',
    icon: Settings,
    dataTestId: 'tab-settings',
    permission: 'settings',
    tone: 'muted',
  },
]

const headerActionBtn =
  'relative inline-flex items-center justify-center rounded-lg border border-slate-200/70 bg-white/55 p-1.5 text-slate-600 transition-colors hover:border-slate-300/80 hover:bg-white hover:text-slate-800'

export const Layout: React.FC = () => {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { user, mode, canAccess, logout } = useAuth()

  const mainNav = useMemo(
    () =>
      ALL_NAV.filter((item) => canAccess(item.permission)).map(
        ({ permission: _p, ...rest }) => rest,
      ),
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
    <BossDashboardProvider>
      <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden">
        <header className="sticky top-0 z-30 border-b border-slate-200/50 bg-[var(--color-bg-warm)]/88 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset] backdrop-blur-md supports-[backdrop-filter]:bg-[var(--color-bg-warm)]/78">
          <div className="mx-auto w-full max-w-6xl min-w-0 px-3 md:px-4">
            {/* 第一层：品牌 + 操作 */}
            <div className="flex min-w-0 items-center justify-between gap-3 py-2 md:py-2.5">
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold tracking-tight text-slate-900 md:text-[15px]">
                  直播经营看板
                </h1>
                <p className="truncate text-[10px] leading-tight text-slate-500 md:text-[11px]">
                  {user
                    ? `${user.username}${user.role === 'super_admin' ? ' · 管理员' : ''}`
                    : '经营数据展示'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
                <BossAnnouncementCenter buttonClassName={headerActionBtn} />
                {mode === 'session' && user ? (
                  <>
                    <button
                      type="button"
                      className={`${headerActionBtn} md:gap-1.5 md:px-2.5 md:py-1.5`}
                      onClick={() => void handleLogout()}
                      aria-label="退出登录"
                    >
                      <LogOut size={15} strokeWidth={2} />
                      <span className="hidden text-xs md:inline">退出</span>
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {/* 第二层：主导航 */}
            <div className="pb-2 md:pb-2.5">
              <MainNavTabs items={mainNav} onBeforeNavigate={handleNavAttempt} />
            </div>
          </div>
        </header>

        <main
          className={`mx-auto w-full min-w-0 flex-1 overflow-x-hidden py-4 ${
            location.pathname.startsWith('/boss-dashboard')
              ? 'max-w-[1440px] px-3 md:px-6 xl:px-8'
              : 'max-w-6xl px-3 md:px-4'
          }`}
        >
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
    </BossDashboardProvider>
  )
}
