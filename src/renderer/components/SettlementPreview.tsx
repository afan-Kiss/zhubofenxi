import React from 'react'
import { Coins } from 'lucide-react'
import { formatCentToMoney } from '../lib/money'
import type { SettlementPreprocessResult } from '../types/settlement'

interface SettlementPreviewProps {
  canPreprocess: boolean
  disabledReason?: string
  result: SettlementPreprocessResult | null
  onPreprocess: () => void
}

export const SettlementPreview: React.FC<SettlementPreviewProps> = ({
  canPreprocess,
  disabledReason,
  result,
  onPreprocess,
}) => {
  const s = result?.summary

  return (
    <section className="flex h-full min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-2xl border border-white/70 bg-[var(--color-card)] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <h2 className="text-xs font-semibold text-slate-800">结算预处理预览</h2>
        <p className="mt-0.5 text-[10px] text-slate-500">待结算 / 已结算明细</p>
      </div>

      <div className="shrink-0 px-3 py-2">
        <button
          type="button"
          disabled={!canPreprocess}
          onClick={onPreprocess}
          className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition-colors ${
            canPreprocess
              ? 'bg-[var(--color-xhs-red)] text-white shadow-[0_8px_20px_rgba(255,36,66,0.35)]'
              : 'cursor-not-allowed bg-slate-100 text-slate-400'
          }`}
        >
          <Coins size={14} />
          预处理结算明细
        </button>
        {!canPreprocess && disabledReason && (
          <p className="mt-1.5 text-[10px] leading-snug text-rose-500">{disabledReason}</p>
        )}
      </div>

      <div className="xhs-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3 text-[10px]">
        {!s ? (
          <p className="text-slate-400">导入待结算或已结算明细后点击按钮查看预处理结果</p>
        ) : (
          <div className="space-y-2">
            <div className="rounded-xl bg-slate-50/80 p-2">
              <div className="mb-1 text-[11px] font-semibold text-slate-700">待结算明细</div>
              <div className="grid grid-cols-2 gap-1 text-slate-500">
                <span>原始行数</span><span className="text-right text-slate-800">{s.pendingRawRows}</span>
                <span>有效记录</span><span className="text-right text-slate-800">{s.pendingValidCount}</span>
                <span>异常记录</span><span className="text-right text-amber-600">{s.pendingAbnormalCount}</span>
                <span>正向金额</span><span className="text-right text-slate-800">{formatCentToMoney(s.pendingIncomeCent)}</span>
                <span>退款/扣回</span><span className="text-right text-amber-600">{formatCentToMoney(s.pendingRefundCent)}</span>
                <span>扣费金额</span><span className="text-right text-amber-600">{formatCentToMoney(s.pendingFeeCent)}</span>
                <span>缺少订单号</span><span className="text-right text-amber-600">{s.pendingMissingOrderIdCount}</span>
                <span>金额解析失败</span><span className="text-right text-amber-600">{s.pendingMoneyParseFailCount}</span>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50/80 p-2">
              <div className="mb-1 text-[11px] font-semibold text-slate-700">已结算明细</div>
              <div className="grid grid-cols-2 gap-1 text-slate-500">
                <span>原始行数</span><span className="text-right text-slate-800">{s.settledRawRows}</span>
                <span>有效记录</span><span className="text-right text-slate-800">{s.settledValidCount}</span>
                <span>异常记录</span><span className="text-right text-amber-600">{s.settledAbnormalCount}</span>
                <span>正向金额</span><span className="text-right text-slate-800">{formatCentToMoney(s.settledIncomeCent)}</span>
                <span>退款/扣回</span><span className="text-right text-amber-600">{formatCentToMoney(s.settledRefundCent)}</span>
                <span>扣费金额</span><span className="text-right text-amber-600">{formatCentToMoney(s.settledFeeCent)}</span>
                <span>缺少订单号</span><span className="text-right text-amber-600">{s.settledMissingOrderIdCount}</span>
                <span>金额解析失败</span><span className="text-right text-amber-600">{s.settledMoneyParseFailCount}</span>
                <span>结算时间缺失/失败</span><span className="text-right text-amber-600">{s.settledMissingTimeCount}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
