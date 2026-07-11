import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  fetchBossAnnouncements,
  fetchBossDashboard,
  markAllBossAnnouncementsRead,
  markBossAnnouncementPopupShown,
  markBossAnnouncementRead,
  type BossAnnouncementView,
  type BossDashboardPayload,
} from '../lib/boss-dashboard-api'
import { useAuth } from './AuthProvider'

interface BossDashboardContextValue {
  data: BossDashboardPayload | null
  announcements: BossAnnouncementView[]
  unreadCount: number
  popupCandidate: BossAnnouncementView | null
  loading: boolean
  error: string | null
  refreshDisplay: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  markPopupShown: (id: string) => Promise<void>
}

const BossDashboardContext = createContext<BossDashboardContextValue | null>(null)

let sharedDashboardPromise: Promise<BossDashboardPayload> | null = null

function loadDashboardOnce(): Promise<BossDashboardPayload> {
  if (!sharedDashboardPromise) {
    sharedDashboardPromise = fetchBossDashboard().finally(() => {
      sharedDashboardPromise = null
    })
  }
  return sharedDashboardPromise
}

export const BossDashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { canAccess, user } = useAuth()
  const enabled = Boolean(user)
  const canViewBossPage = canAccess('boss_dashboard')
  const [data, setData] = useState<BossDashboardPayload | null>(null)
  const [announcements, setAnnouncements] = useState<BossAnnouncementView[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [popupCandidate, setPopupCandidate] = useState<BossAnnouncementView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedRef = useRef(false)

  const refreshAnnouncements = useCallback(async () => {
    if (!enabled) return
    try {
      const res = await fetchBossAnnouncements()
      setAnnouncements(res.announcements)
      setUnreadCount(res.unreadCount)
      setPopupCandidate(res.popupCandidate)
    } catch {
      /* 保留旧公告 */
    }
  }, [enabled])

  const refreshDisplay = useCallback(async () => {
    if (!canViewBossPage) return
    setLoading(true)
    setError(null)
    try {
      const payload = await loadDashboardOnce()
      setData(payload)
      setAnnouncements(payload.announcements)
      setUnreadCount(payload.unreadAnnouncementCount)
      await refreshAnnouncements()
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [canViewBossPage, refreshAnnouncements])

  useEffect(() => {
    if (!canViewBossPage || loadedRef.current) return
    loadedRef.current = true
    void refreshDisplay()
  }, [canViewBossPage, refreshDisplay])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      void refreshAnnouncements()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [enabled, refreshAnnouncements])

  const markRead = useCallback(
    async (id: string) => {
      await markBossAnnouncementRead(id)
      await refreshAnnouncements()
    },
    [refreshAnnouncements],
  )

  const markAllRead = useCallback(async () => {
    await markAllBossAnnouncementsRead()
    await refreshAnnouncements()
  }, [refreshAnnouncements])

  const markPopupShown = useCallback(
    async (id: string) => {
      await markBossAnnouncementPopupShown(id)
      setPopupCandidate(null)
      await refreshAnnouncements()
    },
    [refreshAnnouncements],
  )

  const value = useMemo(
    () => ({
      data,
      announcements,
      unreadCount,
      popupCandidate,
      loading,
      error,
      refreshDisplay,
      markRead,
      markAllRead,
      markPopupShown,
    }),
    [
      data,
      announcements,
      unreadCount,
      popupCandidate,
      loading,
      error,
      refreshDisplay,
      markRead,
      markAllRead,
      markPopupShown,
    ],
  )

  return <BossDashboardContext.Provider value={value}>{children}</BossDashboardContext.Provider>
}

export function useBossDashboard(): BossDashboardContextValue {
  const ctx = useContext(BossDashboardContext)
  if (!ctx) {
    throw new Error('useBossDashboard must be used within BossDashboardProvider')
  }
  return ctx
}

export function useBossDashboardOptional(): BossDashboardContextValue | null {
  return useContext(BossDashboardContext)
}
