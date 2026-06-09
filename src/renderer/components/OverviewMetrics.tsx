import React from 'react'
import type { AttributionValidation, BusinessOverview } from '../types/business'
import { formatCentToMoney, formatRate } from '../lib/businessAnalyzer'

interface OverviewMetricsProps {
  overview: BusinessOverview
  validation?: AttributionValidation
}

function MetricPill({
  label,
  value,
  hint,
  warn,
}: {
  label: string
  value: string
  hint?: string
  warn?: boolean
}) {
  return (
    <div
      className={`rounded-lg border px-2 py-1 ${
        warn ? 'border-amber-200 bg-amber-50/80' : 'border-slate-100 bg-white'
      }`}
      title={hint}
    >
      <div className="text-[9px] text-slate-500">{label}</div>
      <div className="text-[11px] font-semibold text-slate-900">{value}</div>
    </div>
  )
}

export const OverviewMetrics: React.FC<OverviewMetricsProps> = ({ overview: o, validation }) => {
  return (
    <div className="flex min-h-0 flex-col gap-1">
      <div className="text-[10px] font-medium text-slate-600">核心经营指标</div>
      {o.unassignedOrderCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
          存在未归属订单 {o.unassignedOrderCount} 单，建议检查主播时间规则
        </div>
      )}
      {validation && !validation.orderCountOk && validation.orderCountMessage && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-700">
          {validation.orderCountMessage}
        </div>
      )}
      {validation && !validation.gmvOk && validation.gmvMessage && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-700">
          {validation.gmvMessage}
        </div>
      )}
      <div className="xhs-scroll grid max-h-[88px] grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-7">
        <MetricPill label="当月 GMV" value={formatCentToMoney(o.gmvCent)} hint="按下单时间" />
        <MetricPill label="订单数" value={String(o.orderCount)} hint="唯一订单号去重" />
        <MetricPill
          label="实际签收单数"
          value={String(o.actualSignedCount)}
          hint="已签收且未退款"
        />
        <MetricPill
          label="实际签收金额"
          value={formatCentToMoney(o.actualSignedAmountCent)}
        />
        <MetricPill label="退货单数" value={String(o.returnCount)} />
        <MetricPill label="退货金额" value={formatCentToMoney(o.returnAmountCent)} />
        <MetricPill label="退货率" value={formatRate(o.returnRate)} />
        <MetricPill label="品退单数" value={String(o.qualityReturnCount)} />
        <MetricPill label="品退金额" value={formatCentToMoney(o.qualityReturnAmountCent)} />
        <MetricPill label="品退率" value={formatRate(o.qualityReturnRate)} />
        <MetricPill label="已结算" value={formatCentToMoney(o.settledAmountCent)} />
        <MetricPill label="待结算" value={formatCentToMoney(o.pendingAmountCent)} />
        <MetricPill
          label="经营毛利"
          value={formatCentToMoney(o.grossProfitCent)}
          hint={o.grossProfitNote}
          warn={o.grossProfitNote.includes('估算') || o.grossProfitNote.includes('未扣除')}
        />
      </div>
      <div className="flex flex-wrap gap-2 text-[9px] text-slate-500">
        <span>未归属 {o.unassignedOrderCount} 单</span>
        <span>异常 {o.abnormalOrderCount} 单</span>
        <span>账单未匹配 {o.unmatchedBillOrderCount} 单</span>
        {o.qualityReasonMissing && (
          <span className="text-amber-600">品退：原因缺失，无法完整判断</span>
        )}
      </div>
      <p className="text-[9px] leading-snug text-slate-400">{o.grossProfitNote}</p>
    </div>
  )
}
