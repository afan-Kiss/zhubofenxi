import React, { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { ViewportModal } from '../ui/ViewportModal'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  headerExtra?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  testId?: string
  /** 变化时将内容区滚回顶部（如翻页） */
  scrollResetKey?: string | number
  /** 嵌套弹窗可抬高层级，避免与下层同 z-index 叠影 */
  zIndexClass?: string
}

/**
 * 业务明细弹窗壳（兼容旧名 BoardDrawerShell）。
 * 居中 Modal：遮罩/Esc 不关闭，仅右上角 X；手机全屏。
 */
export const BoardDrawerShell: React.FC<Props> = ({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  children,
  footer,
  testId,
  scrollResetKey,
  zIndexClass = 'z-[100]',
}) => {
  const titleId = useId()
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    contentRef.current?.scrollTo({ top: 0 })
  }, [open, scrollResetKey])

  return (
    <ViewportModal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      closeOnBackdrop={false}
      closeOnEscape={false}
      mobileFullscreen
      initialFocusRef={closeBtnRef}
      zIndexClass={zIndexClass}
      backdropClassName="bg-black/35"
      panelClassName="border border-rose-100/80 bg-[#fffaf8] max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]"
    >
      <div data-testid={testId} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <header className="board-modal-header relative z-[1] flex shrink-0 items-start justify-between gap-3 border-b border-rose-100/80 bg-[#fffaf8] px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="text-sm font-semibold text-slate-900 sm:text-base">
              {title}
            </h3>
            {subtitle ? (
              <p className="mt-0.5 break-words text-xs text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            title="关闭"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-slate-700 sm:h-9 sm:w-9"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div
          ref={contentRef}
          className="board-modal-content min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 sm:p-5"
        >
          {headerExtra ? <div className="mb-4 min-w-0">{headerExtra}</div> : null}
          <div className="min-w-0">{children}</div>
        </div>

        {footer ? (
          <div className="board-modal-footer relative z-[1] shrink-0 border-t border-rose-50 bg-[#fffaf8] p-3 sm:px-5">
            {footer}
          </div>
        ) : null}
      </div>
    </ViewportModal>
  )
}

/** 新名别名，便于后续逐步迁移调用方 */
export const BoardModalShell = BoardDrawerShell
