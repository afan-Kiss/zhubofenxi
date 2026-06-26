import React, { useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { formatRatePercent } from './operationsReportFormatters'
import type { BusinessInsightActionStatsPayload } from '../../pages/operations/operationsReportTypes'

const TYPE_LABEL: Record<string, string> = {
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

const ENTITY_LABEL: Record<string, string> = {
  anchor: '主播',
  product: '商品',
  price_band: '价格带',
  after_sales_reason: '售后原因',
  system: '系统',
}

interface Props {
  rangeStartDate: string
  rangeEndDate: string
  scope: 'daily' | 'weekly' | 'custom'
  refreshToken?: number
}

export const BusinessInsightActionStatsCard: React.FC<Props> = ({
  rangeStartDate,
  rangeEndDate,
  scope,
  refreshToken = 0,
}) => {
  const [stats, setStats] = useState<BusinessInsightActionStatsPayload | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams({
          startDate: rangeStartDate,
          endDate: rangeEndDate,
          scope,
        })
        const res = await apiRequest<BusinessInsightActionStatsPayload>(
          `/api/board/operations-business-insight-action-stats?${qs}`,
        )
        if (!cancelled) setStats(res)
      } catch {
        if (!cancelled) setStats(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [rangeStartDate, rangeEndDate, scope, refreshToken])

  if (loading && !stats) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        加载经营建议执行统计…
      </div>
    )
  }

  if (!stats) return null

  const { summary, byType, byEntityType, dailyTrend } = stats
  const hasRecords = summary.total > 0

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h4 className="text-sm font-semibold text-slate-900">经营建议执行统计</h4>
      <p className="mt-1 text-xs text-slate-500">
        统计当前周期内已记录的处理状态，未操作的建议不计入总数
      </p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
        <span>共 {summary.total} 条</span>
        <span>待处理 {summary.pending}</span>
        <span>已处理 {summary.handled}</span>
        <span>已复盘 {summary.reviewed}</span>
        <span>已忽略 {summary.ignored}</span>
        <span>处理率 {formatRatePercent(summary.handleRate)}</span>
        <span>忽略率 {formatRatePercent(summary.ignoreRate)}</span>
      </div>

      {!hasRecords ? (
        <p className="mt-3 text-xs text-slate-500">暂无已记录的处理状态，处理建议后将在此汇总</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {byType.length > 0 ? (
            <StatsBucketTable title="按建议类型" rows={byType} labelOf={(k) => TYPE_LABEL[k] ?? k} />
          ) : null}
          {byEntityType.length > 0 ? (
            <StatsBucketTable
              title="按关联对象"
              rows={byEntityType}
              labelOf={(k) => ENTITY_LABEL[k] ?? k}
            />
          ) : null}
        </div>
      )}

      {dailyTrend.some((d) => d.total > 0) ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-600">最近 7 天处理趋势（按更新时间）</p>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs text-slate-600">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-500">
                  <th className="px-2 py-1">日期</th>
                  <th className="px-2 py-1">更新数</th>
                  <th className="px-2 py-1">已处理</th>
                  <th className="px-2 py-1">已复盘</th>
                  <th className="px-2 py-1">已忽略</th>
                  <th className="px-2 py-1">处理率</th>
                </tr>
              </thead>
              <tbody>
                {dailyTrend.map((row) => (
                  <tr key={row.date} className="border-b border-slate-50">
                    <td className="px-2 py-1">{row.date.slice(5)}</td>
                    <td className="px-2 py-1">{row.total}</td>
                    <td className="px-2 py-1">{row.handled}</td>
                    <td className="px-2 py-1">{row.reviewed}</td>
                    <td className="px-2 py-1">{row.ignored}</td>
                    <td className="px-2 py-1">{formatRatePercent(row.handleRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const StatsBucketTable: React.FC<{
  title: string
  rows: BusinessInsightActionStatsPayload['byType']
  labelOf: (key: string) => string
}> = ({ title, rows, labelOf }) => (
  <div>
    <p className="text-xs font-medium text-slate-600">{title}</p>
    <ul className="mt-2 space-y-1 text-xs text-slate-600">
      {rows.slice(0, 6).map((row) => (
        <li key={row.key} className="flex flex-wrap justify-between gap-2">
          <span>{labelOf(row.key)}</span>
          <span>
            {row.total} 条 · 处理率 {formatRatePercent(row.handleRate)}
          </span>
        </li>
      ))}
    </ul>
  </div>
)
