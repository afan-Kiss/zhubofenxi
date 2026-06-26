import React, { useMemo, useState } from 'react'
import { apiRequest } from '../../lib/api'
import type {
  BusinessInsightActionState,
  BusinessInsightActionStatus,
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

const STATUS_LABEL: Record<BusinessInsightActionStatus, string> = {
  pending: '待处理',
  handled: '已处理',
  ignored: '已忽略',
  reviewed: '已复盘',
}

const STATUS_CLASS: Record<BusinessInsightActionStatus, string> = {
  pending: 'bg-sky-100 text-sky-800',
  handled: 'bg-emerald-100 text-emerald-800',
  ignored: 'bg-slate-100 text-slate-500',
  reviewed: 'bg-violet-100 text-violet-800',
}

function formatEvidenceValue(value: string | number | null): string {
  if (value == null) return '—'
  return String(value)
}

function resolveStatus(item: BusinessInsightItem): BusinessInsightActionStatus {
  return item.actionState?.status ?? 'pending'
}

interface Props {
  insights?: BusinessInsightsPayload | null
  rangeStartDate: string
  rangeEndDate: string
  scope: 'daily' | 'weekly' | 'custom'
  onRefresh?: () => void | Promise<void>
}

export const BusinessInsightCards: React.FC<Props> = ({
  insights,
  rangeStartDate,
  rangeEndDate,
  scope,
  onRefresh,
}) => {
  const items = insights?.items ?? []
  const [showIgnored, setShowIgnored] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const stats = useMemo(() => {
    const counts = { total: items.length, pending: 0, handled: 0, reviewed: 0, ignored: 0 }
    for (const item of items) {
      const status = resolveStatus(item)
      counts[status] += 1
    }
    return counts
  }, [items])

  const activeItems = items.filter((item) => resolveStatus(item) !== 'ignored')
  const ignoredItems = items.filter((item) => resolveStatus(item) === 'ignored')

  const saveAction = async (
    item: BusinessInsightItem,
    status: BusinessInsightActionStatus,
    extra?: Partial<Pick<BusinessInsightActionState, 'note' | 'reviewResult' | 'remindTomorrow'>>,
  ) => {
    setSavingId(item.id)
    try {
      await apiRequest('/api/board/operations-business-insight-actions', {
        method: 'POST',
        body: JSON.stringify({
          insightId: item.id,
          insightType: item.type,
          entityType: item.relatedEntity.type,
          entityId: item.relatedEntity.id,
          entityName: item.relatedEntity.name,
          rangeStartDate,
          rangeEndDate,
          scope,
          status,
          note: extra?.note ?? item.actionState?.note,
          reviewResult: extra?.reviewResult ?? item.actionState?.reviewResult,
          remindTomorrow: extra?.remindTomorrow ?? item.actionState?.remindTomorrow ?? false,
        }),
      })
      await onRefresh?.()
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">经营动作建议</h3>
        {items.length > 0 ? (
          <p className="text-xs text-slate-500">
            经营建议：共 {stats.total} 条｜待处理 {stats.pending}｜已处理 {stats.handled}｜已复盘{' '}
            {stats.reviewed}｜已忽略 {stats.ignored}
          </p>
        ) : null}
      </div>
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
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {activeItems.map((item) => (
              <InsightCard
                key={item.id}
                item={item}
                saving={savingId === item.id}
                onSave={saveAction}
              />
            ))}
          </div>
          {ignoredItems.length > 0 ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowIgnored((v) => !v)}
                className="text-xs text-slate-500 underline"
              >
                {showIgnored ? '收起' : '展开'}已忽略建议（{ignoredItems.length}）
              </button>
              {showIgnored ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {ignoredItems.map((item) => (
                    <InsightCard
                      key={item.id}
                      item={item}
                      saving={savingId === item.id}
                      muted
                      onSave={saveAction}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

const InsightCard: React.FC<{
  item: BusinessInsightItem
  saving: boolean
  muted?: boolean
  onSave: (
    item: BusinessInsightItem,
    status: BusinessInsightActionStatus,
    extra?: Partial<Pick<BusinessInsightActionState, 'note' | 'reviewResult' | 'remindTomorrow'>>,
  ) => Promise<void>
}> = ({ item, saving, muted = false, onSave }) => {
  const status = resolveStatus(item)
  const [note, setNote] = useState(item.actionState?.note ?? '')
  const [reviewResult, setReviewResult] = useState(item.actionState?.reviewResult ?? '')
  const [remindTomorrow, setRemindTomorrow] = useState(item.actionState?.remindTomorrow ?? false)
  const [showReview, setShowReview] = useState(false)

  return (
    <article
      className={`rounded-2xl border p-4 shadow-sm ${
        muted ? 'border-slate-100 bg-slate-50 opacity-80' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_CLASS[item.priority]}`}
        >
          优先级 {PRIORITY_LABEL[item.priority]}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {TYPE_LABEL[item.type]}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
          {STATUS_LABEL[status]}
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

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <label className="block text-xs text-slate-600">
          处理备注
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
            placeholder="记录处理动作或跟进计划"
          />
        </label>
        {showReview ? (
          <label className="block text-xs text-slate-600">
            复盘结果
            <textarea
              value={reviewResult}
              onChange={(e) => setReviewResult(e.target.value)}
              rows={2}
              maxLength={500}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
              placeholder="复盘后结果与后续调整"
            />
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={remindTomorrow}
            onChange={(e) => setRemindTomorrow(e.target.checked)}
          />
          明日继续提醒
        </label>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            disabled={saving}
            onClick={() => void onSave(item, 'handled', { note, reviewResult, remindTomorrow })}
          >
            标记已处理
          </ActionButton>
          <ActionButton
            disabled={saving}
            onClick={() => void onSave(item, 'ignored', { note, reviewResult, remindTomorrow })}
          >
            忽略
          </ActionButton>
          <ActionButton
            disabled={saving}
            onClick={() => {
              setShowReview(true)
              void onSave(item, 'reviewed', { note, reviewResult, remindTomorrow })
            }}
          >
            写复盘
          </ActionButton>
          <ActionButton
            disabled={saving}
            onClick={() => void onSave(item, 'pending', { note, reviewResult, remindTomorrow })}
          >
            恢复待处理
          </ActionButton>
        </div>
      </div>
    </article>
  )
}

const ActionButton: React.FC<{
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}> = ({ disabled, onClick, children }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
  >
    {children}
  </button>
)
