import React from 'react'
import { getGlobalAlerts } from '../lib/fieldMapper'
import type { FieldMappingResult } from '../types/fieldMapping'
import type { ImportedExcelFile } from '../types/import'
import { MappingSelect } from './MappingSelect'

interface FieldMappingPanelProps {
  orderMapping: FieldMappingResult | null
  liveMapping: FieldMappingResult | null
  pendingSettlementMapping: FieldMappingResult | null
  settledSettlementMapping: FieldMappingResult | null
  orderFile?: ImportedExcelFile
  liveFile?: ImportedExcelFile
  pendingSettlementFile?: ImportedExcelFile
  settledSettlementFile?: ImportedExcelFile
  onFieldChange: (fileId: string, fieldKey: string, header: string | null) => void
}

interface SectionProps {
  title: string
  file?: ImportedExcelFile
  mapping: FieldMappingResult | null
  emptyText: string
  onFieldChange: (fileId: string, fieldKey: string, header: string | null) => void
}

const FieldMappingSection: React.FC<SectionProps> = ({
  title,
  file,
  mapping,
  emptyText,
  onFieldChange,
}) => {
  if (!file || !mapping) {
    return (
      <div className="flex min-h-0 flex-col rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-3 py-3">
        <h3 className="text-[11px] font-semibold text-slate-700">{title}</h3>
        <p className="mt-2 text-[10px] text-slate-400">{emptyText}</p>
      </div>
    )
  }

  const headers = file.headers

  return (
    <div className="flex min-h-0 flex-col rounded-2xl border border-white/80 bg-white px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.05)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold text-slate-800">{title}</h3>
        <span
          className="truncate text-[10px] text-slate-400"
          title={file.fileName}
        >
          {file.fileName}
        </span>
      </div>

      <div className="xhs-scroll min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {mapping.mappings.map((field) => (
          <div key={field.key} className="grid grid-cols-[72px_1fr] items-center gap-2">
            <span
              className={`text-[10px] font-medium ${
                field.required && !field.header ? 'text-rose-500' : 'text-slate-500'
              }`}
            >
              {field.label}
              {field.required ? ' *' : ''}
            </span>
            <MappingSelect
              value={field.header}
              options={headers}
              confidence={field.confidence}
              onChange={(header) => onFieldChange(file.id, field.key, header)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export const FieldMappingPanel: React.FC<FieldMappingPanelProps> = ({
  orderMapping,
  liveMapping,
  pendingSettlementMapping,
  settledSettlementMapping,
  orderFile,
  liveFile,
  pendingSettlementFile,
  settledSettlementFile,
  onFieldChange,
}) => {
  const alerts = getGlobalAlerts(
    orderMapping,
    liveMapping,
    pendingSettlementMapping,
    settledSettlementMapping,
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/70 bg-[var(--color-card)]/90 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <h2 className="text-xs font-semibold text-slate-800">字段映射确认</h2>
        <p className="mt-0.5 text-[10px] text-slate-500">
          导入后自动识别，可在下拉框中手动调整
        </p>
      </div>

      {alerts.length > 0 && (
        <div className="shrink-0 space-y-1 border-b border-slate-100 px-3 py-2">
          {alerts.map((alert) => (
            <div
              key={alert.message}
              className={`rounded-xl px-2.5 py-1.5 text-[10px] font-medium ${
                alert.type === 'error'
                  ? 'bg-rose-50 text-rose-600'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {alert.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2 overflow-hidden p-2">
        <FieldMappingSection
          title="订单表字段映射"
          file={orderFile}
          mapping={orderMapping}
          emptyText="未导入订单表"
          onFieldChange={onFieldChange}
        />
        <FieldMappingSection
          title="直播表字段映射"
          file={liveFile}
          mapping={liveMapping}
          emptyText="未导入直播场次表"
          onFieldChange={onFieldChange}
        />
        <FieldMappingSection
          title="待结算明细字段映射"
          file={pendingSettlementFile}
          mapping={pendingSettlementMapping}
          emptyText="未导入待结算明细"
          onFieldChange={onFieldChange}
        />
        <FieldMappingSection
          title="已结算明细字段映射"
          file={settledSettlementFile}
          mapping={settledSettlementMapping}
          emptyText="未导入已结算明细"
          onFieldChange={onFieldChange}
        />
      </div>
    </section>
  )
}
