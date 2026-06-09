import React, { useCallback, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { getFileTypeLabel, getFileTypeOptions, getStatusLabel } from '../lib/fileClassifier'
import type { ImportedExcelFile } from '../types/import'

interface ImportZoneProps {
  slotFiles: {
    order?: ImportedExcelFile
    live?: ImportedExcelFile
    pendingSettlement?: ImportedExcelFile
    settledSettlement?: ImportedExcelFile
    unknown: ImportedExcelFile[]
  }
  importCount: number
  onImportFiles: (files: FileList | File[]) => Promise<void>
  onRemove: (id: string) => void
  onFileTypeChange: (id: string, fileType: ImportedExcelFile['fileType']) => void
}

export const ImportZone: React.FC<ImportZoneProps> = ({
  slotFiles,
  importCount,
  onImportFiles,
  onRemove,
  onFileTypeChange,
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const dropped = e.dataTransfer?.files
      if (dropped?.length) {
        await onImportFiles(dropped)
      }
    },
    [onImportFiles],
  )

  const handleInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files
      if (selected?.length) {
        await onImportFiles(selected)
      }
      e.target.value = ''
    },
    [onImportFiles],
  )

  const statusStyle: Record<ImportedExcelFile['status'], string> = {
    identified: 'bg-emerald-50 text-emerald-700',
    needs_confirm: 'bg-amber-50 text-amber-700',
    error: 'bg-rose-50 text-rose-600',
  }

  const slots: Array<{
    key: 'order' | 'live' | 'pendingSettlement' | 'settledSettlement'
    title: string
    required: boolean
    emptyText: string
  }> = [
    {
      key: 'order',
      title: '当月订单表',
      required: true,
      emptyText: '请导入当月订单明细',
    },
    {
      key: 'live',
      title: '直播场次表',
      required: false,
      emptyText: '未导入直播场次表，将使用时间规则归属主播',
    },
    {
      key: 'pendingSettlement',
      title: '待结算明细',
      required: false,
      emptyText: '未导入待结算明细，无法统计未结算金额',
    },
    {
      key: 'settledSettlement',
      title: '已结算明细',
      required: false,
      emptyText: '未导入已结算明细，无法统计已结算金额',
    },
  ]

  return (
    <section
      className={`shrink-0 rounded-2xl border bg-white/80 px-3 py-2 transition-colors ${
        isDragging
          ? 'border-[var(--color-xhs-red)] bg-rose-50/60'
          : 'border-white/70 shadow-[0_6px_20px_rgba(15,23,42,0.05)]'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="flex min-h-[52px] items-center gap-3"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-xhs-red)] to-[var(--color-xhs-red-soft)] text-white shadow-sm">
          <Upload size={16} />
        </div>
        <div className="min-w-0 flex-1 cursor-pointer">
          <div className="text-[11px] font-medium text-slate-800">
            拖入订单表、直播表、账单表
          </div>
          <div className="text-[10px] text-slate-500">
            支持 .xlsx / .xls · 已导入 <span className="font-semibold text-[var(--color-xhs-red)]">{importCount}</span> 个文件
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {slots.map((slot) => {
          const file = slotFiles[slot.key]
          if (!file) {
            return (
              <div
                key={slot.key}
                className={`rounded-xl border px-3 py-2 ${
                  slot.required
                    ? 'border-rose-200 bg-rose-50/40'
                    : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold text-slate-700">{slot.title}</h3>
                  <span
                    className={`text-[10px] ${
                      slot.required ? 'text-rose-500' : 'text-slate-400'
                    }`}
                  >
                    {slot.required ? '必填' : '选填'}
                  </span>
                </div>
                <p
                  className={`mt-1 text-[10px] leading-snug ${
                    slot.required ? 'text-rose-500' : 'text-slate-400'
                  }`}
                >
                  {slot.emptyText}
                </p>
              </div>
            )
          }

          return (
            <div
              key={slot.key}
              className="rounded-xl border border-white/80 bg-white px-3 py-2 shadow-[0_6px_18px_rgba(15,23,42,0.06)]"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-[11px] font-semibold text-slate-800">{slot.title}</h3>
                <button
                  type="button"
                  onClick={() => onRemove(file.id)}
                  className="text-[10px] text-slate-400 hover:text-slate-700"
                >
                  移除
                </button>
              </div>

              <div className="mt-1 truncate text-[10px] text-slate-500" title={file.fileName}>
                {file.fileName}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">
                Sheet: {file.sheetName || '—'} · {file.rowCount} 行
              </div>

              <div className="mt-1 flex items-center gap-2">
                <select
                  value={file.fileType}
                  onChange={(e) =>
                    onFileTypeChange(file.id, e.target.value as ImportedExcelFile['fileType'])
                  }
                  className="min-w-0 flex-1 appearance-none rounded-lg border border-slate-100 bg-white px-2 py-1 text-[10px] text-slate-700"
                >
                  {getFileTypeOptions().map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyle[file.status]}`}
                >
                  {getStatusLabel(file.status)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {slotFiles.unknown.length > 0 && (
        <div className="xhs-scroll mt-2 max-h-[74px] overflow-y-auto rounded-xl border border-amber-100 bg-amber-50/50 px-2 py-1.5">
          {slotFiles.unknown.map((file) => (
            <div key={file.id} className="mb-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate text-slate-600">{file.fileName}</span>
              <span className="shrink-0 text-amber-600">{getFileTypeLabel(file.fileType)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
