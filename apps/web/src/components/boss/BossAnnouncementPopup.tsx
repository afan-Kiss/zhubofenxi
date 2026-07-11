import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { BossAnnouncementView } from '../../lib/boss-dashboard-api'

const EXIT_MS = 200

export interface BossAnnouncementPopupProps {
  open: boolean
  item: BossAnnouncementView
  onDismiss: () => void
  onViewShop: () => void
}

export const BossAnnouncementPopup: React.FC<BossAnnouncementPopupProps> = ({
  open,
  item,
  onDismiss,
  onViewShop,
}) => {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setVisible(true)
    } else {
      const timer = window.setTimeout(() => setVisible(false), EXIT_MS)
      return () => window.clearTimeout(timer)
    }
  }, [open])

  if (!mounted || (!open && !visible)) return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${open ? '' : 'pointer-events-none'}`}
      style={{ height: '100dvh', maxHeight: '100dvh' }}
      role="presentation"
    >
      <button
        type="button"
        aria-label="关闭提醒"
        className={`absolute inset-0 bg-slate-900/20 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onDismiss}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        className={`relative w-full max-w-md overflow-hidden rounded-2xl border border-rose-100 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.12)] transition-[opacity,transform] duration-200 ${
          open ? 'opacity-100' : 'scale-[0.98] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-rose-50 bg-rose-50/40 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold text-rose-700">体验分下降提醒</h3>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-white/80"
              onClick={onDismiss}
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-rose-700">{item.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{item.content}</p>
          {item.suggestion ? (
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.suggestion}</p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              onClick={onDismiss}
            >
              知道了
            </button>
            <button
              type="button"
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
              onClick={onViewShop}
            >
              查看店铺
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
