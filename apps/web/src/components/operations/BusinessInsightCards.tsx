import React from 'react'
import type {
  BusinessInsightItem,
  BusinessInsightPriority,
  BusinessInsightType,
  BusinessInsightsPayload,
} from '../../pages/operations/operationsReportTypes'

const TYPE_LABEL: Record<BusinessInsightType, string> = {
  promote_product: '继续主推',
  pause_product: '暂停主推',
  review_product: '复查商品',
  review_anchor: '复盘转化',
  increase_anchor_schedule: '可考虑加场',
  optimize_anchor_product_match: '优化货盘匹配',
  focus_price_band: '重点价格带',
  after_sales_check: '售后排查',
  data_quality_warning: '数据维护',
}

const PRIORITY_LABEL: Record<BusinessInsightPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const PRIORITY_CLASS: Record<BusinessInsightPriority, string> = {
  high: 'bg-rose-100 text-rose-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-100 text-slate-700',
}

function formatEvidenceValue(value: string | number | null): string {
  if (value == null) return '—'
  return String(value)
}

interface Props {
  insights?: BusinessInsightsPayload | null
}

export const BusinessInsightCards: React.FC<Props> = ({ insights }) => {
  const items = insights?.items ?? []

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">经营动作建议</h3>
      {insights?.dataQuality.warnings?.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {insights.dataQuality.warnings.slice(0, 4).map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          暂无足够可靠的数据生成经营建议
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((item) => (
            <InsightCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

const InsightCard: React.FC<{ item: BusinessInsightItem }> = ({ item }) => (
  <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_CLASS[item.priority]}`}
      >
        优先级 {PRIORITY_LABEL[item.priority]}
      </span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
        {TYPE_LABEL[item.type]}
      </span>
    </div>
    <h4 className="text-sm font-semibold text-slate-900">{item.title}</h4>
    <p className="mt-2 text-xs leading-relaxed text-slate-600">{item.reason}</p>
    <p className="mt-2 text-xs font-medium text-slate-800">{item.suggestedAction}</p>
    <div className="mt-3 space-y-1 border-t border-slate-100 pt-2">
      <p className="text-xs font-medium text-slate-500">依据</p>
      {item.evidence.map((ev) => (
        <p key={`${ev.label}-${String(ev.value)}`} className="text-xs text-slate-600">
          {ev.label}：{formatEvidenceValue(ev.value)}
          {ev.unit ? ` ${ev.unit}` : ''}
        </p>
      ))}
    </div>
    {item.dataQuality.warnings.length > 0 ? (
      <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">
        {item.dataQuality.warnings.join('；')}
      </div>
    ) : null}
  </article>
)
