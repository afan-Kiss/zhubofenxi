import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { FieldMappingPanel } from './FieldMappingPanel'
import { PreprocessPreview } from './PreprocessPreview'
import { SettlementPreview } from './SettlementPreview'
import { AttributionDiagnosticsPanel } from './AttributionDiagnosticsPanel'
import type { FieldMappingResult } from '../types/fieldMapping'
import type { ImportedExcelFile } from '../types/import'
import type { AnalyzedOrderView } from '../types/business'
import type { OrderDedupeResult } from '../types/order'
import type { SettlementPreprocessResult } from '../types/settlement'
import { getFileTypeLabel, getFileTypeOptions } from '../lib/fileClassifier'

interface AdvancedDiagnosticsPanelProps {
  orderMapping: FieldMappingResult | null
  liveMapping: FieldMappingResult | null
  pendingSettlementMapping: FieldMappingResult | null
  settledSettlementMapping: FieldMappingResult | null
  orderFile?: ImportedExcelFile
  liveFile?: ImportedExcelFile
  pendingSettlementFile?: ImportedExcelFile
  settledSettlementFile?: ImportedExcelFile
  unknownFiles: ImportedExcelFile[]
  onFieldChange: (fileId: string, fieldKey: string, header: string | null) => void
  onFileTypeChange: (id: string, fileType: ImportedExcelFile['fileType']) => void
  canPreprocess: boolean
  preprocessDisabledReason?: string
  preprocessResult: OrderDedupeResult | null
  onPreprocess: () => void
  settlementCanPreprocess: boolean
  settlementDisabledReason?: string
  settlementResult: SettlementPreprocessResult | null
  onSettlementPreprocess: () => void
  analyzedOrders: AnalyzedOrderView[]
  abnormalOrders: AnalyzedOrderView[]
}

export const AdvancedDiagnosticsPanel: React.FC<AdvancedDiagnosticsPanelProps> = ({
  orderMapping,
  liveMapping,
  pendingSettlementMapping,
  settledSettlementMapping,
  orderFile,
  liveFile,
  pendingSettlementFile,
  settledSettlementFile,
  unknownFiles,
  onFieldChange,
  onFileTypeChange,
  canPreprocess,
  preprocessDisabledReason,
  preprocessResult,
  onPreprocess,
  settlementCanPreprocess,
  settlementDisabledReason,
  settlementResult,
  onSettlementPreprocess,
  analyzedOrders,
  abnormalOrders,
}) => {
  const [open, setOpen] = useState(false)
  const [diagTab, setDiagTab] = useState<'fields' | 'attribution'>('fields')

  return (
    <section className="shrink-0 rounded-xl border border-slate-100 bg-white/90">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-50/80"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        高级设置 / 字段诊断 / 订单归属诊断
        <span className="font-normal text-slate-400">（默认折叠）</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-2 pb-2">
          <div className="mb-1 flex gap-1 border-b border-slate-100">
            <button
              type="button"
              onClick={() => setDiagTab('fields')}
              className={`px-2 py-1 text-[10px] ${
                diagTab === 'fields' ? 'font-medium text-slate-900' : 'text-slate-400'
              }`}
            >
              字段与预处理
            </button>
            <button
              type="button"
              onClick={() => setDiagTab('attribution')}
              className={`px-2 py-1 text-[10px] ${
                diagTab === 'attribution' ? 'font-medium text-slate-900' : 'text-slate-400'
              }`}
            >
              订单归属诊断
            </button>
          </div>

          {diagTab === 'attribution' ? (
            <AttributionDiagnosticsPanel orders={analyzedOrders} abnormalOrders={abnormalOrders} />
          ) : (
            <div className="max-h-[220px] overflow-y-auto xhs-scroll">
              <p className="mb-2 rounded-lg border border-rose-100 bg-rose-50/50 px-2 py-1 text-[10px] text-slate-600">
                主播与时间规则：请点击顶部「主播规则设置」按钮配置（直播场次优先，时间规则兜底）。
              </p>
              {unknownFiles.length > 0 && (
                <div className="mb-2 rounded-lg border border-amber-100 bg-amber-50/60 px-2 py-1.5 text-[10px] text-amber-800">
                  未识别类型的文件：
                  {unknownFiles.map((f) => (
                    <div key={f.id} className="mt-1 flex items-center gap-2">
                      <span className="truncate">{f.fileName}</span>
                      <select
                        value={f.fileType}
                        onChange={(e) =>
                          onFileTypeChange(f.id, e.target.value as ImportedExcelFile['fileType'])
                        }
                        className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px]"
                      >
                        {getFileTypeOptions().map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-slate-500">{getFileTypeLabel(f.fileType)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <FieldMappingPanel
                  orderMapping={orderMapping}
                  liveMapping={liveMapping}
                  pendingSettlementMapping={pendingSettlementMapping}
                  settledSettlementMapping={settledSettlementMapping}
                  orderFile={orderFile}
                  liveFile={liveFile}
                  pendingSettlementFile={pendingSettlementFile}
                  settledSettlementFile={settledSettlementFile}
                  onFieldChange={onFieldChange}
                />
                <div className="flex flex-col gap-2">
                  <PreprocessPreview
                    canPreprocess={canPreprocess}
                    disabledReason={preprocessDisabledReason}
                    result={preprocessResult}
                    onPreprocess={onPreprocess}
                  />
                  <SettlementPreview
                    canPreprocess={settlementCanPreprocess}
                    disabledReason={settlementDisabledReason}
                    result={settlementResult}
                    onPreprocess={onSettlementPreprocess}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
