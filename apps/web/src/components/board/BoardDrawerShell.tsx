import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  headerExtra?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  testId?: string
}

export const BoardDrawerShell: React.FC<Props> = ({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  children,
  footer,
  testId,
}) => {
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setVisible(true)
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
    const t = window.setTimeout(() => setVisible(false), 280)
    return () => window.clearTimeout(t)
  }, [open])

  if (!mounted || (!open && !visible)) return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex justify-end transition-opacity duration-300 ${
        open ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      style={{ height: '100dvh', maxHeight: '100dvh' }}
      aria-hidden={!open}
      role="presentation"
    >
      <button
        type="button"
        className={`absolute inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? 'viewport-modal-backdrop opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-label="关闭"
      />
      <aside
        data-testid={testId}
        className={`board-drawer-panel relative flex h-[100dvh] max-h-[100dvh] w-full flex-col bg-[#fffaf8] shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-rose-100/80 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
            {headerExtra}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-rose-50 bg-[#fffaf8] p-3">{footer}</div>
        ) : null}
      </aside>
    </div>,
    document.body,
  )
}
