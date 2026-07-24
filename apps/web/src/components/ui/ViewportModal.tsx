import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { lockBodyScroll } from '../../lib/body-scroll-lock'

const EXIT_MS = 220

export interface ViewportModalProps {
  open: boolean
  onClose: () => void
  labelledBy?: string
  describedBy?: string
  panelClassName?: string
  backdropClassName?: string
  zIndexClass?: string
  children: React.ReactNode
  /** 点击遮罩是否关闭；默认 true（兼容二维码/确认类弹窗） */
  closeOnBackdrop?: boolean
  /** Esc 是否关闭；默认 true */
  closeOnEscape?: boolean
  /** 小屏全屏；业务明细弹窗传 true */
  mobileFullscreen?: boolean
  /** 打开时聚焦目标；默认聚焦面板内第一个可聚焦元素 */
  initialFocusRef?: React.RefObject<HTMLElement | null>
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
  closeOnBackdrop = true,
  closeOnEscape = true,
  mobileFullscreen = false,
  initialFocusRef,
}) => {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const autoLabelId = useId()
  const resolvedLabelledBy = labelledBy || autoLabelId

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setVisible(true)
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      const unlock = lockBodyScroll()
      return () => {
        unlock()
        const prev = previousFocusRef.current
        if (prev && typeof prev.focus === 'function') {
          window.setTimeout(() => {
            try {
              prev.focus()
            } catch {
              /* ignore */
            }
          }, 0)
        }
      }
    }
    const timer = window.setTimeout(() => setVisible(false), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open || !closeOnEscape) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closeOnEscape, onClose])

  useEffect(() => {
    if (!open) return
    const focusTarget =
      initialFocusRef?.current ||
      panelRef.current?.querySelector<HTMLElement>(
        'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
      )
    window.setTimeout(() => {
      focusTarget?.focus?.()
    }, 30)
  }, [open, initialFocusRef])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!mounted || (!open && !visible)) return null

  // 业务全屏壳：固定可视高度，避免仅 max-h 时 flex 子项无法收缩、页脚被裁切/与内容重叠
  const defaultPanelSize = mobileFullscreen
    ? 'h-[100dvh] max-h-[100dvh] w-screen rounded-none sm:h-[calc(100dvh-48px)] sm:max-h-[calc(100dvh-48px)] sm:w-[min(1280px,calc(100vw-48px))] sm:rounded-[20px]'
    : 'max-h-[min(76dvh,calc(100dvh-2rem))] w-[min(1180px,calc(100vw-1.5rem))] rounded-2xl'

  // 进场只用 CSS keyframes（.viewport-modal-*）；退出仅淡出 opacity，避免与 animation 的 transform 叠抢
  const backdropMotion = open
    ? 'viewport-modal-backdrop'
    : 'opacity-0 transition-opacity duration-200'
  const panelMotion = open
    ? 'viewport-modal-panel'
    : 'opacity-0 transition-opacity duration-200'

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center ${zIndexClass} ${
        open ? '' : 'pointer-events-none'
      } ${mobileFullscreen ? 'p-0 sm:p-6' : 'p-3 md:p-4'}`}
      style={{ height: '100dvh', maxHeight: '100dvh' }}
      role="presentation"
    >
      <div
        className={`board-modal-backdrop absolute inset-0 backdrop-blur-[2px] ${backdropMotion} ${backdropClassName}`.trim()}
        aria-hidden="true"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedLabelledBy}
        aria-describedby={describedBy}
        className={`board-modal-panel relative flex min-h-0 flex-col overflow-hidden shadow-[0_24px_64px_rgba(15,23,42,0.18)] ${defaultPanelSize} ${panelMotion} ${
          panelClassName.includes('bg-') ? '' : 'bg-white'
        } ${panelClassName}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        {!labelledBy ? (
          <span id={autoLabelId} className="sr-only">
            弹窗
          </span>
        ) : null}
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
