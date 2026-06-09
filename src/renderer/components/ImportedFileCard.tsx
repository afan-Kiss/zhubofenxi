import React from 'react'
import { FileSpreadsheet, X } from 'lucide-react'
import { getFileTypeLabel, getStatusLabel } from '../lib/fileClassifier'
import type { ImportedExcelFile } from '../types/import'

interface ImportedFileCardProps {
  file: ImportedExcelFile
  onRemove: (id: string) => void
}

const statusStyle: Record<ImportedExcelFile['status'], string> = {
  identified: 'bg-emerald-50 text-emerald-700',
  needs_confirm: 'bg-amber-50 text-amber-700',
  error: 'bg-rose-50 text-rose-600',
}

export const ImportedFileCard: React.FC<ImportedFileCardProps> = ({ file, onRemove }) => {
  return (
    <div className="flex w-[220px] shrink-0 flex-col rounded-xl border border-white/80 bg-white px-3 py-2 shadow-[0_6px_18px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileSpreadsheet size={14} className="shrink-0 text-[var(--color-xhs-red)]" />
          <span className="truncate text-[11px] font-semibold text-slate-900" title={file.fileName}>
            {file.fileName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onRemove(file.id)}
          className="shrink-0 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="移除文件"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-1.5 text-[10px] text-slate-500">
        类型：<span className="font-medium text-slate-700">{getFileTypeLabel(file.fileType)}</span>
      </div>

      {file.errorMessage ? (
        <div className="mt-1 line-clamp-2 text-[10px] text-rose-500">{file.errorMessage}</div>
      ) : (
        <>
          <div className="mt-0.5 truncate text-[10px] text-slate-500" title={file.sheetName}>
            Sheet：{file.sheetName || '—'}
          </div>
          <div className="mt-0.5 flex gap-2 text-[10px] text-slate-500">
            <span>表头 {file.headers.length}</span>
            <span>数据 {file.rowCount} 行</span>
          </div>
        </>
      )}

      <div className="mt-1.5">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyle[file.status]}`}
        >
          {getStatusLabel(file.status)}
        </span>
      </div>
    </div>
  )
}
