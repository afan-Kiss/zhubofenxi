import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface PaginationProps {
  page: number
  total: number
  pageSize: number
  onPage: (page: number) => void
  className?: string
  disabled?: boolean
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  total,
  pageSize,
  onPage,
  className = '',
  disabled = false,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)

  if (total <= pageSize) return null

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600 ${className}`}
    >
      <span>
        共 {total} 条 · 第 {safePage}/{totalPages} 页
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled || safePage <= 1}
          onClick={() => onPage(safePage - 1)}
          className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40"
        >
          <ChevronLeft size={14} />
          上一页
        </button>
        <button
          type="button"
          disabled={disabled || safePage >= totalPages}
          onClick={() => onPage(safePage + 1)}
          className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40"
        >
          下一页
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
