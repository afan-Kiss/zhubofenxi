import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bell,
  ChevronRight,
  Info,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import type { BossAnnouncementView } from '../../lib/boss-dashboard-api'
import { announcementTextClass } from '../../lib/boss-dashboard-api'

const EXIT_MS = 220

function formatAnnouncementTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function AnnouncementIcon({ tone }: { tone: string }) {
  if (tone === 'positive') {
    return <TrendingUp size={16} className="shrink-0 text-emerald-600" aria-hidden />
  }
  if (tone === 'negative') {
    return <TrendingDown size={16} className="shrink-0 text-rose-600" aria-hidden />
  }
  return <Info size={16} className="shrink-0 text-slate-500" aria-hidden />
}

function toneAccentClass(tone: string, isRead: boolean): string {
  if (tone === 'positive') return 'border-l-2 border-l-emerald-400'
  if (tone === 'negative') return 'border-l-2 border-l-rose-400'
  if (!isRead) return 'border-l-2 border-l-slate-300'
  return 'border-l-2 border-l-transparent'
}

function AnnouncementCard({
  item,
  onOpen,
}: {
  item: BossAnnouncementView
  onOpen: (item: BossAnnouncementView) => void
}) {
  const isRead = item.isRead
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`group w-full rounded-[13px] border text-left transition-colors ${toneAccentClass(item.tone, isRead)} ${
        isRead
          ? 'border-slate-100/90 bg-white hover:border-slate-200 hover:bg-slate-50/60'
          : 'border-slate-200/70 bg-slate-50/70 hover:border-slate-300/80 hover:bg-slate-50'
      } px-3 py-3`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex flex-col items-center gap-1">
          <AnnouncementIcon tone={item.tone} />
          {!isRead ? (
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" aria-hidden />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm font-medium leading-snug ${announcementTextClass(item.tone)}`}>
              {item.title}
            </p>
            <span className="shrink-0 text-[10px] text-slate-400">{formatAnnouncementTime(item.createdAt)}</span>
          </div>
          {item.shopName ? (
            <p className="mt-0.5 text-[11px] text-slate-500">{item.shopName}</p>
          ) : null}
          <p className={`mt-1.5 text-xs leading-relaxed ${isRead ? 'text-slate-500' : 'text-slate-600'}`}>
            {item.content}
          </p>
          {item.suggestion ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{item.suggestion}</p>
          ) : null}
          <span className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500 group-hover:text-slate-800">
            查看详情
            <ChevronRight size={12} aria-hidden />
          </span>
        </div>
      </div>
    </button>
  )
}

function AnnouncementSkeleton() {
  return (
    <div className="space-y-3 p-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse rounded-[13px] border border-slate-100 bg-white px-3 py-3">
          <div className="h-3 w-2/5 rounded bg-slate-100" />
          <div className="mt-2 h-2.5 w-1/4 rounded bg-slate-100" />
          <div className="mt-3 h-2 w-full rounded bg-slate-100" />
          <div className="mt-1.5 h-2 w-4/5 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Bell size={22} strokeWidth={1.75} aria-hidden />
      </div>
      <p className="mt-4 text-sm font-medium text-slate-700">暂时没有新公告</p>
      <p className="mt-1.5 max-w-[240px] text-xs leading-relaxed text-slate-500">
        店铺分变化和经营提醒会显示在这里
      </p>
    </div>
  )
}

export interface BossAnnouncementDrawerProps {
  open: boolean
  onClose: () => void
  announcements: BossAnnouncementView[]
  unreadCount: number
  loading: boolean
  refreshError: string | null
  refreshing: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onRetry: () => void
  onNavigateShop: (shopKey: string) => void
}

export const BossAnnouncementDrawer: React.FC<BossAnnouncementDrawerProps> = ({
  open,
  onClose,
  announcements,
  unreadCount,
  loading,
  refreshError,
  refreshing,
  onMarkRead,
  onMarkAllRead,
  onRetry,
  onNavigateShop,
}) => {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setVisible(true)
      return
    }
    const timer = window.setTimeout(() => setVisible(false), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const handleOpenItem = useCallback(
    (item: BossAnnouncementView) => {
      void onMarkRead(item.id)
      if (item.shopKey) onNavigateShop(item.shopKey)
      onClose()
    },
    [onClose, onMarkRead, onNavigateShop],
  )

  if (!mounted || (!open && !visible)) return null

  const total = announcements.length
  const showSkeleton = (loading || refreshing) && announcements.length === 0

  return createPortal(
    <div
      className={`boss-announce-overlay fixed inset-0 z-[80] ${open ? '' : 'pointer-events-none'}`}
      style={{ height: '100dvh', maxHeight: '100dvh' }}
      role="presentation"
    >
      <button
        type="button"
        aria-label="关闭公告"
        className={`boss-announce-backdrop absolute inset-0 bg-slate-900/[0.14] backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* 桌面：右侧抽屉 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="boss-announce-title"
        className={`boss-announce-drawer-desktop pointer-events-auto absolute right-4 top-4 bottom-4 hidden w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-[20px] border border-slate-200/80 bg-[#fdfcfa] shadow-[0_8px_40px_rgba(15,23,42,0.1)] transition-[opacity,transform] duration-200 md:flex ${
          open ? 'boss-announce-drawer-in opacity-100' : 'translate-x-3 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <DrawerChrome
          total={total}
          unreadCount={unreadCount}
          refreshError={refreshError}
          refreshing={refreshing}
          onClose={onClose}
          onMarkAllRead={onMarkAllRead}
          onRetry={onRetry}
        />
        <DrawerBody
          showSkeleton={showSkeleton}
          announcements={announcements}
          onOpenItem={handleOpenItem}
        />
      </aside>

      {/* 手机：Bottom Sheet */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="boss-announce-title-mobile"
        className={`boss-announce-sheet pointer-events-auto absolute inset-x-0 bottom-0 flex max-h-[min(88dvh,90vh)] flex-col overflow-hidden rounded-t-[22px] border border-b-0 border-slate-200/80 bg-[#fdfcfa] shadow-[0_-8px_32px_rgba(15,23,42,0.12)] transition-[opacity,transform] duration-[240ms] md:hidden ${
          open ? 'boss-announce-sheet-in opacity-100' : 'translate-y-4 opacity-0'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pt-2.5 pb-1" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-slate-300/80" />
        </div>
        <DrawerChrome
          total={total}
          unreadCount={unreadCount}
          refreshError={refreshError}
          refreshing={refreshing}
          onClose={onClose}
          onMarkAllRead={onMarkAllRead}
          onRetry={onRetry}
          titleId="boss-announce-title-mobile"
        />
        <DrawerBody
          showSkeleton={showSkeleton}
          announcements={announcements}
          onOpenItem={handleOpenItem}
        />
      </aside>
    </div>,
    document.body,
  )
}

function DrawerChrome({
  total,
  unreadCount,
  refreshError,
  refreshing,
  onClose,
  onMarkAllRead,
  onRetry,
  titleId = 'boss-announce-title',
}: {
  total: number
  unreadCount: number
  refreshError: string | null
  refreshing: boolean
  onClose: () => void
  onMarkAllRead: () => void
  onRetry: () => void
  titleId?: string
}) {
  return (
    <header className="shrink-0 border-b border-slate-200/60 bg-white/70 px-4 py-3 backdrop-blur-sm">
      <div className="flex min-h-[52px] items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 id={titleId} className="text-[15px] font-semibold text-slate-900">
              公告提醒
            </h2>
            {unreadCount > 0 ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                {unreadCount} 未读
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            共 {total} 条{unreadCount > 0 ? `，${unreadCount} 条未读` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={unreadCount === 0}
            className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void onMarkAllRead()}
          >
            全部已读
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
      {refreshError ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
          <span className="min-w-0 truncate">{refreshError}</span>
          <button
            type="button"
            className="shrink-0 font-medium text-amber-800 underline-offset-2 hover:underline"
            onClick={() => void onRetry()}
            disabled={refreshing}
          >
            重新读取
          </button>
        </div>
      ) : null}
    </header>
  )
}

function DrawerBody({
  showSkeleton,
  announcements,
  onOpenItem,
}: {
  showSkeleton: boolean
  announcements: BossAnnouncementView[]
  onOpenItem: (item: BossAnnouncementView) => void
}) {
  return (
    <div className="boss-announce-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
      {showSkeleton ? (
        <AnnouncementSkeleton />
      ) : announcements.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2.5 pb-1">
          {announcements.map((item) => (
            <AnnouncementCard key={item.id} item={item} onOpen={onOpenItem} />
          ))}
        </div>
      )}
    </div>
  )
}
