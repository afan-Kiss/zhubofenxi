import React, { useCallback, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useBossDashboardOptional } from '../../providers/BossDashboardProvider'
import { BossAnnouncementDrawer } from './BossAnnouncementDrawer'
import { BossAnnouncementPopup } from './BossAnnouncementPopup'

export const BossAnnouncementCenter: React.FC<{ buttonClassName?: string }> = ({
  buttonClassName = 'relative rounded-lg border border-slate-200/70 bg-white/55 p-1.5 text-slate-600 transition-colors hover:border-slate-300/80 hover:bg-white hover:text-slate-800',
}) => {
  const ctx = useBossDashboardOptional()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (ctx?.popupCandidate) setPopupOpen(true)
  }, [ctx?.popupCandidate])

  const overlayOpen = open || (popupOpen && Boolean(ctx?.popupCandidate))

  useEffect(() => {
    if (!overlayOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [overlayOpen])

  useEffect(() => {
    if (!overlayOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (popupOpen && ctx?.popupCandidate) {
        setPopupOpen(false)
      } else if (open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlayOpen, open, popupOpen, ctx?.popupCandidate])

  const handleRetry = useCallback(async () => {
    if (!ctx?.refreshAnnouncements) return
    setRefreshing(true)
    setRefreshError(null)
    const ok = await ctx.refreshAnnouncements()
    if (!ok) setRefreshError('公告读取失败，请稍后重试')
    setRefreshing(false)
  }, [ctx])

  if (!ctx) return null

  const {
    announcements,
    unreadCount,
    popupCandidate,
    loading,
    markRead,
    markAllRead,
    markPopupShown,
  } = ctx

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => setOpen(true)}
        aria-label="公告"
      >
        <Bell size={16} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-rose-600 px-1 text-center text-[10px] text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      <BossAnnouncementDrawer
        open={open}
        onClose={() => setOpen(false)}
        announcements={announcements}
        unreadCount={unreadCount}
        loading={loading}
        refreshError={refreshError}
        refreshing={refreshing}
        onMarkRead={(id) => void markRead(id)}
        onMarkAllRead={() => void markAllRead()}
        onRetry={() => void handleRetry()}
        onNavigateShop={(shopKey) => navigate(`/boss-dashboard?shop=${shopKey}`)}
      />

      {popupCandidate ? (
        <BossAnnouncementPopup
          open={popupOpen}
          item={popupCandidate}
          onDismiss={() => {
            void markPopupShown(popupCandidate.id)
            setPopupOpen(false)
          }}
          onViewShop={() => {
            void markPopupShown(popupCandidate.id)
            setPopupOpen(false)
            navigate(`/boss-dashboard?shop=${popupCandidate.shopKey ?? ''}`)
          }}
        />
      ) : null}
    </>
  )
}
