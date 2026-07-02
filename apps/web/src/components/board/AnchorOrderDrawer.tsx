import React, { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../lib/api'
import {
  buildAnchorDrawerSummaryText,
  formatShippedOrderCountLabel,
} from '../../lib/anchor-drawer-summary'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../ui/Pagination'
import { showDrawerSignQualityMetrics, showAnchorDrillSignedTab } from '../../lib/board-rate-display'
import { BoardDrawerShell } from './BoardDrawerShell'
import { BoardDrillOrderTable, type BoardDrillOrderRow } from './BoardDrillOrderTable'

const DRAWER_STAT_FONT =
  "font-['Microsoft_YaHei','微软雅黑',sans-serif] text-sm leading-relaxed text-slate-700"

interface AnchorDrillData {
  anchorId: string
  anchorName: string
  stats: Record<string, unknown> | null
  tabs?: Array<{ key: string; label: string; count: number }>
  liveSessions?: Array<{
    liveId: string
    liveName: string
    startTime: string
    endTime: string
    durationMinutes: number
    durationText: string
  }>
  liveSummaryText?: string
  blacklistedBuyerIds?: string[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  rows: BoardDrillOrderRow[]
}

interface Props {
  open: boolean
  onClose: () => void
  anchorName: string
  anchorId?: string
  preset?: string
  startDate: string
  endDate: string
  rowSnapshot?: Record<string, unknown>
}

function statNum(stats: Record<string, unknown> | undefined, key: string): number {
  return Number(stats?.[key] ?? 0)
}

export const AnchorOrderDrawer: React.FC<Props> = ({
  open,
  onClose,
  anchorName,
  anchorId,
  preset,
  startDate,
  endDate,
  rowSnapshot,
}) => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AnchorDrillData | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [copyDone, setCopyDone] = useState(false)
  const [liveSessionsOpen, setLiveSessionsOpen] = useState(false)
  const [orderTab, setOrderTab] = useState<'signed' | 'all'>('all')
  const [anchorOptions, setAnchorOptions] = useState<Array<{ id: string; name: string }>>([])
  const [assigningOrderNo, setAssigningOrderNo] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageSize = 20
  const isUnassignedDrawer = anchorName?.trim() === '未归属' || anchorId?.trim() === '未归属'

  useEffect(() => {
    if (!open) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    setPage(1)
    setData(null)
    setError(null)
    setCopyDone(false)
    setLiveSessionsOpen(false)
    setOrderTab(showAnchorDrillSignedTab(preset) ? 'signed' : 'all')
    setAssignError(null)
    setAssigningOrderNo(null)
  }, [open, anchorName, anchorId, startDate, endDate, preset])

  useEffect(() => {
    if (!open || !isUnassignedDrawer) {
      setAnchorOptions([])
      return
    }
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await apiRequest<{ anchors: Array<{ id: string; name: string }> }>(
          '/api/anchors/options',
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        setAnchorOptions(res.anchors ?? [])
      } catch {
        if (!controller.signal.aborted) setAnchorOptions([])
      }
    })()
    return () => controller.abort()
  }, [open, isUnassignedDrawer])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open || !startDate || !endDate) return

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const qs = new URLSearchParams({
          startDate,
          endDate,
          page: String(page),
          pageSize: String(pageSize),
          statusType: orderTab,
        })
        if (preset) qs.set('preset', preset)
        const name = anchorName?.trim()
        const id = anchorId?.trim()
        if (name === '未归属' || id === '未归属') {
          qs.set('anchorName', '未归属')
        } else {
          if (id) qs.set('anchorId', id)
          if (name) qs.set('anchorName', name)
        }

        const res = await apiRequest<AnchorDrillData>(`/api/board/anchor-drill?${qs}`, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setData(res)
      } catch (e) {
        if (controller.signal.aborted) return
        const msg = e instanceof Error ? e.message : '订单明细加载失败'
        console.error('[AnchorOrderDrawer] load failed', {
          anchorId,
          anchorName,
          startDate,
          endDate,
          page,
          error: e,
        })
        setData(null)
        setError(msg)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [open, anchorId, anchorName, preset, startDate, endDate, page, reloadNonce, orderTab])

  useEffect(() => {
    if (!import.meta.env.DEV || !data || !rowSnapshot) return
    const rowCount = Number(rowSnapshot.orderCount ?? 0)
    const total = data.pagination.total
    if (total === 0 && rowCount > 0) {
      console.warn('[AnchorOrderDrawer] 主播统计与明细不一致，请检查 anchor-drill 数据源', {
        anchorName,
        anchorId,
        rowSnapshotOrderCount: rowCount,
        paginationTotal: total,
      })
    } else if (total !== rowCount && rowCount > 0) {
      console.warn('[AnchorOrderDrawer] 主播统计与明细数量不一致', {
        anchorName,
        anchorId,
        rowSnapshotOrderCount: rowCount,
        paginationTotal: total,
      })
    }
  }, [data, rowSnapshot, anchorName, anchorId])

  const stats = data?.stats ?? (loading ? rowSnapshot : undefined)
  const showInitialSkeleton = loading && !data && !error
  const showSignQuality = showDrawerSignQualityMetrics(preset)
  const showSignedTab = showAnchorDrillSignedTab(preset)

  const shippedOrderAmount =
    statNum(stats, 'validSalesAmount') || statNum(stats, 'effectiveGmv')
  const shippedOrderCount = statNum(stats, 'shippedOrderCount')

  const summaryText =
    stats && !error
      ? buildAnchorDrawerSummaryText({
          startDate,
          endDate,
          anchorName,
          orderCount: statNum(stats, 'orderCount'),
          payAmountYuan: statNum(stats, 'gmv') || statNum(stats, 'totalGmv'),
          signedOrderCount:
            statNum(stats, 'actualSignedCount') ||
            statNum(stats, 'signedOrderCount') ||
            statNum(stats, 'signedCount'),
          signedAmountYuan: statNum(stats, 'actualSignedAmount'),
          refundOrderCount: statNum(stats, 'returnCount') || statNum(stats, 'refundOrderCount'),
          formatMoney,
        })
      : ''

  const handleCopySummary = () => {
    if (!summaryText) return
    void navigator.clipboard?.writeText(summaryText).then(() => {
      setCopyDone(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopyDone(false), 2000)
    })
  }

  const handleManualAssign = useCallback(
    async (orderNo: string, targetAnchorName: string) => {
      if (!orderNo || !targetAnchorName) return
      setAssignError(null)
      setAssigningOrderNo(orderNo)
      try {
        await apiRequest('/api/board/order-anchor-manual-assign', {
          method: 'POST',
          body: JSON.stringify({ orderNo, anchorName: targetAnchorName }),
        })
        setReloadNonce((n) => n + 1)
      } catch (e) {
        setAssignError(e instanceof Error ? e.message : '指定主播失败')
      } finally {
        setAssigningOrderNo(null)
      }
    },
    [],
  )

  useEffect(() => {
    if (!data?.liveSessions?.length) return
    setLiveSessionsOpen(true)
  }, [data?.liveSessions])

  const liveSessions = data?.liveSessions ?? []
  const hasLiveSessions = liveSessions.length > 0

  const headerStatItems: Array<{ key: string; text: string }> = [
    {
      key: 'gmv',
      text: `支付金额 ${formatMoney(statNum(stats, 'gmv') || statNum(stats, 'totalGmv'))}`,
    },
    {
      key: 'shippedAmt',
      text: `发货单金额 ${formatMoney(shippedOrderAmount)}`,
    },
    {
      key: 'shippedCnt',
      text: `发出单数 ${formatShippedOrderCountLabel(shippedOrderCount)}`,
    },
    ...(showSignQuality
      ? [{ key: 'signedAmt', text: `签收 ${formatMoney(statNum(stats, 'actualSignedAmount'))}` }]
      : []),
    { key: 'orders', text: `订单 ${formatCount(statNum(stats, 'orderCount'))}` },
    ...(showSignQuality
      ? [
          {
            key: 'signedCnt',
            text: `签收单 ${formatCount(
              statNum(stats, 'actualSignedCount') ||
                statNum(stats, 'signedOrderCount') ||
                statNum(stats, 'signedCount'),
            )}`,
          },
        ]
      : []),
    {
      key: 'refundAmt',
      text: `退款金额 ${formatMoney(statNum(stats, 'returnAmount') || statNum(stats, 'refundAmount'))}`,
    },
    { key: 'refundCnt', text: `退款订单 ${formatCount(statNum(stats, 'returnCount'))}` },
    ...(showSignQuality
      ? [{ key: 'qualityCnt', text: `品退单 ${formatCount(statNum(stats, 'qualityReturnCount'))}` }]
      : []),
    {
      key: 'refundRate',
      text: `退款率 ${formatRate(stats?.returnRate == null ? null : statNum(stats, 'returnRate'))}`,
    },
    ...(showSignQuality
      ? [
          {
            key: 'qualityRate',
            text: `品退率 ${formatRate(
              stats?.qualityReturnRate == null ? null : statNum(stats, 'qualityReturnRate'),
            )}`,
          },
          {
            key: 'signRate',
            text: `签收率 ${formatRate(stats?.signRate == null ? null : statNum(stats, 'signRate'))}`,
          },
        ]
      : []),
  ]

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title={anchorName}
      testId="anchor-order-drawer"
      subtitle={`${startDate} ~ ${endDate} · 主播订单明细`}
      headerExtra={
        stats ? (
          <div
            className={`mt-2 space-y-2 transition-opacity duration-300 ${
              showInitialSkeleton ? 'opacity-70' : 'opacity-100'
            }`}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {headerStatItems.map((item) => (
                <span key={item.key} className={DRAWER_STAT_FONT}>
                  {item.text}
                </span>
              ))}
            </div>
            {hasLiveSessions ? (
              <div className="rounded-xl border border-rose-100/80 bg-white/70">
                <button
                  type="button"
                  onClick={() => setLiveSessionsOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-rose-50/60"
                >
                  <span className={DRAWER_STAT_FONT}>
                    {data?.liveSummaryText ?? `直播 ${liveSessions.length} 场`}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {liveSessionsOpen ? '收起' : '展开场次'}
                  </span>
                </button>
                {liveSessionsOpen ? (
                  <ul className="max-h-36 space-y-1 overflow-y-auto border-t border-rose-50 px-3 py-2 text-xs text-slate-600">
                    {liveSessions.map((session) => {
                      const start = session.startTime.slice(11, 16)
                      const end = session.endTime.slice(11, 16)
                      const line = `${start}~${end}（${session.durationText}）`
                      return (
                        <li key={`${session.liveId}-${session.startTime}`}>{line}</li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null
      }
      footer={
        data && !error ? (
          <Pagination
            page={data.pagination.page}
            total={data.pagination.total}
            pageSize={data.pagination.pageSize}
            onPage={setPage}
          />
        ) : null
      }
    >
      {showInitialSkeleton ? (
        <BoardDrillOrderTable rows={[]} loading />
      ) : error ? (
        <div className="animate-in fade-in rounded-2xl border border-dashed border-red-200 bg-red-50/50 py-12 text-center duration-300">
          <p className="text-sm text-red-700">订单明细加载失败，请稍后重试</p>
          <p className="mt-1 text-xs text-red-600/80">{error}</p>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="mt-3 rounded-full border border-red-200 bg-white px-4 py-1.5 text-xs text-red-700 transition hover:bg-red-50"
          >
            重试
          </button>
        </div>
      ) : (
        <div
          className={`transition-opacity duration-300 ${loading && data ? 'opacity-60' : 'opacity-100'}`}
        >
          <div className="mb-3 flex flex-wrap gap-1 rounded-2xl bg-white/80 p-1">
            {(data?.tabs ?? [
              ...(showSignedTab ? [{ key: 'signed', label: '实际签收', count: 0 }] : []),
              { key: 'all', label: '全部订单', count: 0 },
            ]).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setOrderTab(t.key === 'all' ? 'all' : 'signed')
                  setPage(1)
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  orderTab === t.key ? 'bg-rose-500 text-white' : 'text-slate-600 hover:bg-rose-50'
                }`}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>
          <BoardDrillOrderTable
            rows={data?.rows ?? []}
            listKey={`anchor-${anchorId ?? anchorName}-${orderTab}-${page}-${data?.rows.length ?? 0}`}
            blacklistedBuyerIds={data?.blacklistedBuyerIds}
            loading={loading && !!data}
            emptyText={
              orderTab === 'signed' ? '当前范围暂无实际签收订单' : '当前范围暂无该主播订单'
            }
            manualAnchorAssign={
              isUnassignedDrawer && anchorOptions.length > 0
                ? {
                    anchorOptions,
                    assigningOrderNo,
                    onAssign: (orderNo, targetAnchorName) => {
                      void handleManualAssign(orderNo, targetAnchorName)
                    },
                  }
                : undefined
            }
          />
          {assignError ? <p className="mt-2 text-xs text-red-600">{assignError}</p> : null}
          {summaryText ? (
            <div
              className={`mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-100/80 bg-rose-50/40 px-4 py-3 ${DRAWER_STAT_FONT}`}
            >
              <p className="min-w-0 flex-1 leading-relaxed text-slate-800">{summaryText}</p>
              <button
                type="button"
                onClick={handleCopySummary}
                className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                  copyDone
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
                }`}
              >
                {copyDone ? '√已复制' : '复制'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </BoardDrawerShell>
  )
}
