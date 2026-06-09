import React from 'react'
import { LayoutGrid, Table2 } from 'lucide-react'

export type ListViewMode = 'cards' | 'table'

interface Props {
  mode: ListViewMode
  onChange: (mode: ListViewMode) => void
  className?: string
}

export const ListViewToggle: React.FC<Props> = ({ mode, onChange, className = '' }) => {
  return (
    <div
      className={`hidden items-center gap-1 rounded-full border border-rose-100 bg-white p-0.5 md:inline-flex ${className}`}
      role="group"
      aria-label="列表展示方式"
    >
      <button
        type="button"
        onClick={() => onChange('cards')}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
          mode === 'cards'
            ? 'bg-rose-500 text-white shadow-sm'
            : 'text-slate-600 hover:bg-rose-50'
        }`}
      >
        <LayoutGrid size={13} />
        卡片
      </button>
      <button
        type="button"
        onClick={() => onChange('table')}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
          mode === 'table'
            ? 'bg-rose-500 text-white shadow-sm'
            : 'text-slate-600 hover:bg-rose-50'
        }`}
      >
        <Table2 size={13} />
        表格
      </button>
    </div>
  )
}
