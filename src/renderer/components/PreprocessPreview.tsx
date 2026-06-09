import React from 'react'
import { Play } from 'lucide-react'
import { formatCentToMoney } from '../lib/money'
import type { OrderDedupeResult } from '../types/order'

interface PreprocessPreviewProps {
  canPreprocess: boolean
  disabledReason?: string
  result: OrderDedupeResult | null
  onPreprocess: () => void
}

const statItems = (result: OrderDedupeResult) => {
  const s = result.summary
  return [
    { label: '原始订单行数', value: String(s.rawRowCount) },
    { label: '标准化成功', value: String(s.successCount) },
    { label: '异常订单数', value: String(s.abnormalCount), warn: s.abnormalCount > 0 },
    { label: '去重后订单数', value: String(s.uniqueOrderCount) },
    { label: '重复订单号', value: String(s.duplicateOrderIdCount), warn: s.duplicateOrderIdCount > 0 },
    { label: '缺少订单号', value: String(s.missingOrderIdCount), warn: s.missingOrderIdCount > 0 },
    { label: '金额解析失败', value: String(s.moneyParseFailCount), warn: s.moneyParseFailCount > 0 },
    { label: '时间解析失败', value: String(s.timeParseFailCount), warn: s.timeParseFailCount > 0 },
    { label: '去重后 GMV', value: formatCentToMoney(s.totalGmvCent) },
    { label: '有效签收金额', value: formatCentToMoney(s.totalEffectiveSignedCent) },
  ]
}

export const PreprocessPreview: React.FC<PreprocessPreviewProps> = ({
  canPreprocess,
  disabledReason,
  result,
  onPreprocess,
}) => {
  return (
    <section className="flex h-full min-h-0 w-[260px] shrink-0 flex-col overflow-hidden rounded-2xl border border-white/70 bg-[var(--color-card)] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <h2 className="text-xs font-semibold text-slate-800">数据处理预览</h2>
        <p className="mt-0.5 text-[10px] text-slate-500">订单标准化与去重</p>
      </div>

      <div className="shrink-0 px-3 py-2">
        <button
          type="button"
          disabled={!canPreprocess}
          onClick={onPreprocess}
          className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition-colors ${
            canPreprocess
              ? 'bg-[var(--color-xhs-red)] text-white shadow-[0_8px_20px_rgba(255,36,66,0.35)] hover:opacity-95'
              : 'cursor-not-allowed bg-slate-100 text-slate-400'
          }`}
        >
          <Play size={14} />
          预处理订单数据
        </button>
        {!canPreprocess && disabledReason && (
          <p className="mt-1.5 text-[10px] leading-snug text-rose-500">{disabledReason}</p>
        )}
      </div>

      <div className="xhs-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!result ? (
          <p className="text-[10px] text-slate-400">完成订单表映射后点击预处理查看结果</p>
        ) : (
          <ul className="space-y-1.5">
            {statItems(result).map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50/80 px-2 py-1.5"
              >
                <span className="text-[10px] text-slate-500">{item.label}</span>
                <span
                  className={`text-[11px] font-semibold ${
                    item.warn ? 'text-amber-600' : 'text-slate-800'
                  }`}
                >
                  {item.value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
