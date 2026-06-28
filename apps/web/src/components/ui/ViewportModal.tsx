import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const EXIT_MS = 240

export interface ViewportModalProps {
  open: boolean
  onClose: () => void
  labelledBy?: string
  describedBy?: string
  panelClassName?: string
  backdropClassName?: string
  zIndexClass?: string
  children: React.ReactNode
}

export const ViewportModal: React.FC<ViewportModalProps> = ({
  open,
  onClose,
  labelledBy,
  describedBy,
  panelClassName = '',
  backdropClassName = 'bg-black/35',
  zIndexClass = 'z-[140]',
  children,
}) => {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setVisible(true)
      const prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prevOverflow
      }
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

  if (!mounted || (!open && !visible)) return null

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center p-3 md:p-4 ${zIndexClass} ${
        open ? '' : 'pointer-events-none'
      }`}
      style={{ height: '100dvh', maxHeight: '100dvh' }}
      role="presentation"
    >
      <button
        type="button"
        className={`absolute inset-0 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? 'viewport-modal-backdrop opacity-100' : 'opacity-0'
        } ${backdropClassName}`.trim()}
        onClick={onClose}
        aria-label="关闭弹窗"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={`relative flex max-h-[min(76dvh,calc(100dvh-2rem))] w-[min(1180px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl transition-[opacity,transform] duration-200 ${
          open ? 'viewport-modal-panel opacity-100' : 'scale-[0.985] opacity-0'
        } ${panelClassName}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

interface FloatingToastProps {
  message: string | null
  className?: string
}

export const FloatingToast: React.FC<FloatingToastProps> = ({ message, className = '' }) => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || !message) return null

  return createPortal(
    <div className={`floating-toast ${className}`.trim()} role="status">
      {message}
    </div>,
    document.body,
  )
}
