import React from 'react'
import type { FieldMappingResult } from '../types/fieldMapping'
import type { ImportedExcelFile } from '../types/import'

interface UploadSlotGridProps {
  slotFiles: {
    order?: ImportedExcelFile
    live?: ImportedExcelFile
    pendingSettlement?: ImportedExcelFile
    settledSettlement?: ImportedExcelFile
  }
  orderMapping: FieldMappingResult | null
}

function slotHint(
  file: ImportedExcelFile | undefined,
  mapping: FieldMappingResult | null,
  optionalHint: string,
): string | undefined {
  if (!file) return optionalHint
  if (file.status === 'error') return '识别失败，请到高级设置检查字段'
  if (mapping && mapping.missingRequiredFields.length > 0) {
    return '缺少关键字段，请到字段诊断处理'
  }
  if (file.status === 'needs_confirm') return '识别失败，请到高级设置检查字段'
  return undefined
}

export const UploadSlotGrid: React.FC<UploadSlotGridProps> = ({ slotFiles, orderMapping }) => {
  const slots: Array<{
    key: keyof UploadSlotGridProps['slotFiles']
    title: string
    required: boolean
    emptyHint: string
    mapping?: FieldMappingResult | null
  }> = [
    {
      key: 'order',
      title: '当月订单表',
      required: true,
      emptyHint: '未上传',
      mapping: orderMapping,
    },
    {
      key: 'live',
      title: '直播场次表',
      required: false,
      emptyHint: '将按时间规则归属主播',
    },
    {
      key: 'pendingSettlement',
      title: '待结算明细',
      required: false,
      emptyHint: '无法统计待结算金额',
    },
    {
      key: 'settledSettlement',
      title: '已结算明细',
      required: false,
      emptyHint: '无法统计已结算金额',
    },
  ]

  return (
    <div className="grid shrink-0 grid-cols-4 gap-1.5">
      {slots.map((slot) => {
        const file = slotFiles[slot.key]
        const warn = slotHint(file, slot.mapping ?? null, slot.emptyHint)

        return (
          <div
            key={slot.key}
            className={`rounded-xl border px-2 py-1.5 ${
              file
                ? 'border-white/80 bg-white shadow-sm'
                : slot.required
                  ? 'border-rose-100 bg-rose-50/50'
                  : 'border-slate-100 bg-slate-50/60'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-[10px] font-semibold text-slate-800">{slot.title}</span>
              <span
                className={`shrink-0 text-[9px] ${
                  slot.required ? 'text-rose-500' : 'text-slate-400'
                }`}
              >
                {slot.required ? '必填' : '选填'}
              </span>
            </div>
            <div
              className={`mt-0.5 text-[10px] font-medium ${
                file ? 'text-emerald-600' : 'text-slate-400'
              }`}
            >
              {file ? '已上传' : '未上传'}
            </div>
            {file ? (
              <>
                <div className="truncate text-[9px] text-slate-500" title={file.fileName}>
                  {file.fileName}
                </div>
                {slot.key === 'order' && (
                  <div className="text-[9px] text-slate-400">{file.rowCount} 行订单</div>
                )}
              </>
            ) : (
              <div className="text-[9px] leading-snug text-slate-400">{slot.emptyHint}</div>
            )}
            {file && warn && file.status !== 'identified' && (
              <div className="mt-0.5 text-[9px] leading-snug text-amber-600">{warn}</div>
            )}
          </div>
        )
      })}
    </div>
  )

}
