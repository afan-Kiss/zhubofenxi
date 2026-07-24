import React, { useCallback } from 'react'
import { Bell, ChevronRight, Info, TrendingDown, TrendingUp } from 'lucide-react'
import type { BossAnnouncementView } from '../../lib/boss-dashboard-api'
import { announcementTextClass } from '../../lib/boss-dashboard-api'
import { BoardDrawerShell } from '../board/BoardDrawerShell'

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
            <span className="shrink-0 text-[10px] text-slate-400">
              {formatAnnouncementTime(item.createdAt)}
            </span>
          </div>
          {item.shopName ? (
            <p className="mt-0.5 text-[11px] text-slate-500">{item.shopName}</p>
          ) : null}
          <p
            className={`mt-1.5 text-xs leading-relaxed ${isRead ? 'text-slate-500' : 'text-slate-600'}`}
          >
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
        <div
          key={i}
          className="animate-pulse rounded-[13px] border border-slate-100 bg-white px-3 py-3"
        >
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
  const handleOpenItem = useCallback(
    (item: BossAnnouncementView) => {
      void onMarkRead(item.id)
      if (item.shopKey) onNavigateShop(item.shopKey)
      onClose()
    },
    [onClose, onMarkRead, onNavigateShop],
  )

  const total = announcements.length
  const showSkeleton = (loading || refreshing) && announcements.length === 0
  const subtitle =
    unreadCount > 0 ? `共 ${total} 条，${unreadCount} 条未读` : `共 ${total} 条`

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title="公告提醒"
      subtitle={subtitle}
      headerExtra={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {unreadCount > 0 ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                {unreadCount} 未读
              </span>
            ) : null}
            <button
              type="button"
              disabled={unreadCount === 0}
              className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void onMarkAllRead()}
            >
              全部已读
            </button>
          </div>
          {refreshError ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
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
        </div>
      }
    >
      {showSkeleton ? (
        <AnnouncementSkeleton />
      ) : announcements.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2.5 pb-1">
          {announcements.map((item) => (
            <AnnouncementCard key={item.id} item={item} onOpen={handleOpenItem} />
          ))}
        </div>
      )}
    </BoardDrawerShell>
  )
}
