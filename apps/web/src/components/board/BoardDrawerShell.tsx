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
  /** 已签收明细：中性灰绿宽屏，不影响其他指标 Drawer */
  tone?: 'default' | 'signed'
  /** 翻页时滚到指定节点（如表格顶），而非整页内容顶 */
  scrollTargetRef?: React.RefObject<HTMLElement | null>
}

const SIGNED_SIZE =
  'h-[100dvh] max-h-[100dvh] w-screen rounded-none sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(1560px,92vw)] sm:rounded-[20px]'

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
  tone = 'default',
  scrollTargetRef,
}) => {
  const titleId = useId()
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const signed = tone === 'signed'

  useEffect(() => {
    if (!open) return
    const target = scrollTargetRef?.current
    if (target && contentRef.current?.contains(target)) {
      target.scrollIntoView({ block: 'start', behavior: 'auto' })
      return
    }
    contentRef.current?.scrollTo({ top: 0 })
  }, [open, scrollResetKey, scrollTargetRef])

  return (
    <ViewportModal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      closeOnBackdrop={false}
      closeOnEscape={false}
      mobileFullscreen
      sizeClassName={signed ? SIGNED_SIZE : undefined}
      initialFocusRef={closeBtnRef}
      zIndexClass={zIndexClass}
      backdropClassName="bg-black/35"
      panelClassName={
        signed
          ? 'border border-[#E3E7E2] bg-[#F5F6F4] max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]'
          : 'border border-rose-100/80 bg-[#fffaf8] max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]'
      }
    >
      <div data-testid={testId} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={`board-modal-header relative z-[1] flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3 sm:px-5 ${
            signed
              ? 'border-[#E3E7E2] bg-[#FBFCFA]'
              : 'border-rose-100/80 bg-[#fffaf8]'
          }`}
        >
          <div className="min-w-0 flex-1">
            <h3
              id={titleId}
              className={`text-sm font-semibold sm:text-base ${signed ? 'text-[#202722]' : 'text-slate-900'}`}
            >
              {title}
            </h3>
            {subtitle ? (
              <p className={`mt-0.5 break-words text-xs ${signed ? 'text-[#667069]' : 'text-slate-500'}`}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            title="关闭"
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition sm:h-9 sm:w-9 ${
              signed
                ? 'text-[#667069] hover:bg-[#F2F5F2] hover:text-[#202722]'
                : 'text-slate-400 hover:bg-rose-50 hover:text-slate-700'
            }`}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div
          ref={contentRef}
          className={`board-modal-content min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 sm:p-5 ${
            signed ? 'bg-[#F5F6F4]' : ''
          }`}
        >
          {headerExtra ? <div className="mb-4 min-w-0">{headerExtra}</div> : null}
          <div className="min-w-0">{children}</div>
        </div>

        {footer ? (
          <div
            className={`board-modal-footer relative z-[1] shrink-0 border-t p-3 sm:px-5 ${
              signed ? 'border-[#E3E7E2] bg-[#FBFCFA]' : 'border-rose-50 bg-[#fffaf8]'
            }`}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </ViewportModal>
  )
}

/** 新名别名，便于后续逐步迁移调用方 */
export const BoardModalShell = BoardDrawerShell
