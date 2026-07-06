import React, { useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../ui/Pagination'
import { UNMATCHED_OFFICIAL_QUALITY_HINT } from './OfficialQualitySyncNote'
import { BoardDrawerShell } from './BoardDrawerShell'
import { BoardDrillOrderTable, type BoardDrillOrderRow } from './BoardDrillOrderTable'

export type BoardMetricKey =
  | 'gmv'
  | 'effectiveGmv'
  | 'actualSignedAmount'
  | 'signedCount'
  | 'signRate'
  | 'returnAmount'
  | 'returnCount'
  | 'qualityReturnCount'
  | 'qualityReturnRate'
  | 'orderCount'
  | 'freightRefundAmount'
  | 'returnRate'

interface MetricDetailData {
  metric: string
  title: string
  formulaText: string
  dateRange?: { preset?: string; startDate: string; endDate: string }
  summary: {
    totalOrders: number
    matchedOrders: number
    value?: number
    valueRaw?: number
    valueText?: string
    stableValueRaw?: number
    latestValueRaw?: number
    diffAmount?: number
    productRefundAmount?: number
    refundRelatedOrderCount?: number
    refundWithAmountOrderCount?: number
    paidOrderCount?: number
    qualityRefundOrderCount?: number
    unmatchedOfficialQualityCount?: number
    description: string
  }
  tabs: Array<{ key: string; label: string; count: number }>
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  rows: BoardDrillOrderRow[]
  pageSummary?: Record<string, unknown>
  blacklistedBuyerIds?: string[]
  source?: string
  overviewStableWarning?: string
  overviewStableSnapshot?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  metric: BoardMetricKey
  startDate: string
  endDate: string
  preset?: string
  anchorId?: string
  anchorName?: string
  cardValueRaw?: number
  blacklistedBuyerIds?: string[]
  overviewStableSnapshot?: boolean
}

export const BoardMetricDrawer: React.FC<Props> = ({
  open,
  onClose,
  metric,
  startDate,
  endDate,
  preset,
  anchorId,
  anchorName,
  cardValueRaw,
  blacklistedBuyerIds = [],
  overviewStableSnapshot = false,
}) => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MetricDetailData | null>(null)
  const [tab, setTab] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [reloadNonce, setReloadNonce] = useState(0)
  const [liveBlacklist, setLiveBlacklist] = useState<string[]>(blacklistedBuyerIds)

  useEffect(() => {
    if (!open || !startDate || !endDate) return

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const qs = new URLSearchParams({
          metric,
          startDate,
          endDate,
          page: String(page),
          pageSize: String(pageSize),
        })
        if (preset) qs.set('preset', preset)
        if (tab) qs.set('tab', tab)
        if (anchorId) qs.set('anchorId', anchorId)
        if (anchorName) qs.set('anchorName', anchorName)
        if (metric === 'actualSignedAmount' && !anchorId && !anchorName) {
          qs.set('sort', 'anchor_asc')
        }
        if (overviewStableSnapshot) qs.set('overviewStableSnapshot', 'true')
        const res = await apiRequest<MetricDetailData>(`/api/board/metric-detail?${qs}`, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setData(res)
        if (!tab && res.tabs[0]) setTab(res.tabs[0].key)
        if (res.blacklistedBuyerIds) setLiveBlacklist(res.blacklistedBuyerIds)
      } catch (e) {
        if (controller.signal.aborted) return
        setData(null)
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [open, metric, startDate, endDate, page, tab, preset, anchorId, anchorName, pageSize, reloadNonce, overviewStableSnapshot])

  useEffect(() => {
    setPage(1)
    setTab('')
    setData(null)
    setError(null)
  }, [metric, startDate, endDate, open])

  const isRefundMetric = metric === 'returnAmount' || metric === 'returnCount'
  const isQualityMetric = metric === 'qualityReturnCount' || metric === 'qualityReturnRate'
  const unmatchedOfficialCount = Number(data?.summary.unmatchedOfficialQualityCount ?? 0)
  const refundAmountDisplay =
    data?.summary.productRefundAmount ?? data?.summary.valueRaw ?? 0
  const refundRelatedCount =
    data?.summary.refundRelatedOrderCount ?? data?.summary.matchedOrders ?? 0
  const refundWithAmountCount = data?.summary.refundWithAmountOrderCount ?? 0

  const displayValue =
    data?.summary.valueText ??
    (metric.includes('Rate')
      ? formatRate(data?.summary.valueRaw ?? 0)
      : metric.includes('Amount') || metric === 'gmv' || metric === 'effectiveGmv'
        ? formatMoney(data?.summary.valueRaw ?? 0)
        : metric.includes('Count') || metric === 'orderCount' || metric === 'signedCount'
          ? formatCount(data?.summary.valueRaw ?? data?.summary.matchedOrders ?? 0)
          : formatCount(data?.summary.matchedOrders ?? 0))

  const cardMismatch =
    !overviewStableSnapshot &&
    !data?.overviewStableSnapshot &&
    cardValueRaw != null &&
    data?.summary.valueRaw != null &&
    Math.abs(cardValueRaw - data.summary.valueRaw) > 0.02 &&
    !metric.includes('Rate')

  const stableDrawerActive = Boolean(
    overviewStableSnapshot || data?.overviewStableSnapshot || data?.overviewStableWarning,
  )

  const drawerSubtitle = (() => {
    const rangePart =
      data?.dateRange?.startDate && data?.dateRange?.endDate
        ? `${data.dateRange.startDate} ~ ${data.dateRange.endDate} · 本地已同步数据`
        : '本地已同步数据'
    if (data?.source === 'stale') {
      return `${rangePart} · 当前展示本地缓存，最近同步时间见页面顶部`
    }
    return rangePart
  })()

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title={data?.title ?? '指标明细'}
      subtitle={drawerSubtitle}
      footer={
        data ? (
          <Pagination
            page={data.pagination.page}
            total={data.pagination.total}
            pageSize={data.pagination.pageSize}
            onPage={setPage}
          />
        ) : null
      }
    >
      {loading && !data ? (
        <BoardDrillOrderTable rows={[]} loading />
      ) : error ? (
        <div className="animate-in fade-in rounded-2xl border border-dashed border-red-200 bg-red-50/50 py-12 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="mt-3 rounded-full border border-red-200 bg-white px-4 py-1.5 text-xs text-red-700"
          >
            重试
          </button>
        </div>
      ) : data ? (
        <div className="animate-in fade-in space-y-4 duration-300">
          {data.overviewStableWarning ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
              <p className="font-medium">{data.overviewStableWarning}</p>
              {data.summary.stableValueRaw != null && data.summary.latestValueRaw != null ? (
                <p className="mt-2">
                  稳定版：
                  {metric.includes('Rate')
                    ? formatRate(data.summary.stableValueRaw)
                    : metric.includes('Amount') || metric === 'gmv' || metric === 'effectiveGmv'
                      ? formatMoney(data.summary.stableValueRaw)
                      : formatCount(data.summary.stableValueRaw)}
                  {' · '}
                  最新重算：
                  {metric.includes('Rate')
                    ? formatRate(data.summary.latestValueRaw)
                    : metric.includes('Amount') || metric === 'gmv' || metric === 'effectiveGmv'
                      ? formatMoney(data.summary.latestValueRaw)
                      : formatCount(data.summary.latestValueRaw)}
                  {data.summary.diffAmount != null ? (
                    <span>
                      {' '}
                      · 差异：
                      {metric.includes('Rate')
                        ? formatRate(data.summary.diffAmount)
                        : metric.includes('Amount') || metric === 'gmv' || metric === 'effectiveGmv'
                          ? formatMoney(data.summary.diffAmount)
                          : formatCount(data.summary.diffAmount)}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="rounded-2xl bg-gradient-to-br from-rose-50 to-white p-4 text-xs text-slate-700 shadow-sm transition-all">
            <p className="font-medium text-rose-900">{data.formulaText}</p>
            {data.summary.description ? (
              <p className="mt-2 leading-relaxed">{data.summary.description}</p>
            ) : null}
            {isRefundMetric ? (
              <div className="mt-2 space-y-1.5 text-sm font-semibold text-slate-900">
                <p>实际退款金额：{formatMoney(refundAmountDisplay)}</p>
                <p>涉及退款/售后订单数：{formatCount(refundRelatedCount)}</p>
                <p>实际产生退款订单数：{formatCount(refundWithAmountCount)}</p>
              </div>
            ) : isQualityMetric ? (
              <div className="mt-2 space-y-1.5 text-sm font-semibold text-slate-900">
                <p>品退订单数：{formatCount(data.summary.qualityRefundOrderCount ?? data.summary.matchedOrders)}</p>
                <p>
                  支付订单数：{formatCount(data.summary.paidOrderCount ?? data.summary.totalOrders)}
                </p>
                <p>
                  品退率：
                  {formatRate(
                    (data.summary.paidOrderCount ?? 0) > 0
                      ? (data.summary.qualityRefundOrderCount ?? data.summary.matchedOrders ?? 0) /
                          (data.summary.paidOrderCount ?? 1)
                      : 0,
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-lg font-semibold text-slate-900">当前统计值：{displayValue}</p>
            )}
            {cardMismatch ? (
              <p className="mt-1 text-[10px] text-amber-700">
                明细数据来自最新查询结果，首页卡片以当前看板统计为准。
              </p>
            ) : stableDrawerActive && data.summary.stableValueRaw != null ? (
              <p className="mt-1 text-[10px] text-amber-700">
                下方订单明细按最新重算统计，合计金额可能与稳定版卡片不同。
              </p>
            ) : null}
            {isQualityMetric && unmatchedOfficialCount > 0 ? (
              <p className="mt-2 text-[10px] leading-relaxed text-amber-700">
                {UNMATCHED_OFFICIAL_QUALITY_HINT.replace('{count}', String(unmatchedOfficialCount))}
              </p>
            ) : null}
            <p className="mt-1 text-[10px] text-slate-400">
              {isRefundMetric
                ? `明细 ${data.summary.matchedOrders} 笔 / 本期 ${data.summary.totalOrders} 笔`
                : `匹配 ${data.summary.matchedOrders} 笔 / 本期 ${data.summary.totalOrders} 笔`}
            </p>
          </div>
          {data.tabs.length > 1 ? (
            <div className="flex flex-wrap gap-1 rounded-2xl bg-white/80 p-1">
              {data.tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key)
                    setPage(1)
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    tab === t.key ? 'bg-rose-500 text-white' : 'text-slate-600 hover:bg-rose-50'
                  }`}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
          ) : null}
          <BoardDrillOrderTable
            rows={data.rows}
            listKey={`${metric}-${tab}-${data.pagination.page}-${data.rows.length}`}
            blacklistedBuyerIds={liveBlacklist}
            loading={loading && !!data}
            emptyText="该指标下暂无匹配订单"
            amountMode={metric === 'actualSignedAmount' ? 'signed' : 'default'}
          />
        </div>
      ) : null}
    </BoardDrawerShell>
  )
}
