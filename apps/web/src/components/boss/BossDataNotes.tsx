import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props {
  notes: string[]
}

export const BossDataNotes: React.FC<Props> = ({ notes }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-slate-100 bg-white/70 px-4 py-3 text-xs text-slate-500">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-slate-600"
        onClick={() => setOpen((v) => !v)}
      >
        <span>数据口径</span>
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <ul className="mt-2 space-y-1 leading-relaxed">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
