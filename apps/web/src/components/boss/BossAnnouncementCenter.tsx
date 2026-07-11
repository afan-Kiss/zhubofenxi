import React, { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useBossDashboardOptional } from '../../providers/BossDashboardProvider'
import { announcementTextClass } from '../../lib/boss-dashboard-api'

export const BossAnnouncementCenter: React.FC = () => {
  const ctx = useBossDashboardOptional()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)

  useEffect(() => {
    if (ctx?.popupCandidate) setPopupOpen(true)
  }, [ctx?.popupCandidate])

  if (!ctx) return null

  const { announcements, unreadCount, popupCandidate, markRead, markAllRead, markPopupShown } = ctx

  return (
    <>
      <button
        type="button"
        className="relative rounded-full border border-slate-200 bg-white p-2 text-slate-700 hover:bg-rose-50"
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

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20 p-3 md:p-6">
          <div className="flex h-full w-full max-w-md flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="font-semibold text-slate-900">公告提醒</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-slate-800"
                  onClick={() => void markAllRead()}
                >
                  全部已读
                </button>
                <button type="button" onClick={() => setOpen(false)} aria-label="关闭">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {announcements.length === 0 ? (
                <p className="text-sm text-slate-500">暂无公告</p>
              ) : (
                announcements.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="mb-2 w-full rounded-xl border border-slate-100 p-3 text-left hover:bg-slate-50"
                    onClick={() => {
                      void markRead(item.id)
                      if (item.shopKey) navigate(`/boss-dashboard?shop=${item.shopKey}`)
                      setOpen(false)
                    }}
                  >
                    <div className={`text-sm font-medium ${announcementTextClass(item.tone)}`}>
                      {item.title}
                    </div>
                    <div className={`mt-1 text-xs ${announcementTextClass(item.tone)}`}>{item.content}</div>
                    {item.suggestion ? (
                      <div className="mt-2 text-xs text-slate-500">{item.suggestion}</div>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {popupOpen && popupCandidate ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-rose-700">体验分下降提醒</h3>
            <p className="mt-2 text-sm text-rose-700">{popupCandidate.title}</p>
            <p className="mt-2 text-sm text-slate-700">{popupCandidate.content}</p>
            {popupCandidate.suggestion ? (
              <p className="mt-3 text-sm text-slate-600">{popupCandidate.suggestion}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 px-4 py-2 text-sm"
                onClick={() => {
                  void markPopupShown(popupCandidate.id)
                  setPopupOpen(false)
                }}
              >
                知道了
              </button>
              <button
                type="button"
                className="rounded-full bg-rose-600 px-4 py-2 text-sm text-white"
                onClick={() => {
                  void markPopupShown(popupCandidate.id)
                  setPopupOpen(false)
                  navigate(`/boss-dashboard?shop=${popupCandidate.shopKey ?? ''}`)
                }}
              >
                查看店铺
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
