import React, { useCallback, useEffect, useState } from 'react'
import { BuyerDisplay } from './BuyerDisplay'
import type { BuyerOrderDrawerBuyer } from './BuyerOrderDrawer'
import { rowToDrawerBuyer } from '../../lib/buyer-profile'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { earnedAmountFromRow } from '../../lib/buyer-earned-amount'
import { MetricInfoTooltip } from './MetricInfoTooltip'
import { getMetricExplain } from '../../lib/metricExplain'
import { Pagination } from '../ui/Pagination'
import { BoardDrawerShell } from './BoardDrawerShell'

export type BuyerSummaryKey =
  | 'highValue'
  | 'repurchase'
  | 'refund'
  | 'qualityHeavy'

interface Props {
  open: boolean
  onClose: () => void
  summaryKey: BuyerSummaryKey
  cardCount?: number
  onViewBuyerOrders?: (buyer: BuyerOrderDrawerBuyer) => void
}

export const BuyerSummaryDrawer: React.FC<Props> = ({
  open,
  onClose,
  summaryKey,
  cardCount,
  onViewBuyerOrders,
}) => {
  const { formatMoney } = useAmountDisplay()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<{
    title: string
    formula: string
    emptyMessage?: string
    pagination: { page: number; pageSize: number; total: number; totalPages: number }
    items: Array<Record<string, unknown>>
  } | null>(null)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        summaryKey,
        page: String(page),
        pageSize: '20',
      })
      const res = await apiRequest<NonNullable<typeof data>>(
        `/api/board/buyer-ranking/summary-drill?${qs}`,
      )
      if (
        cardCount != null &&
        res?.pagination?.total != null &&
        cardCount !== res.pagination.total
      ) {
        console.warn('[buyer-ranking] summary count mismatch', {
          filterKey: summaryKey,
          cardCount,
          'pagination.total': res.pagination.total,
        })
      }
      setData(res)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [open, summaryKey, page, cardCount])

  useEffect(() => {
    setPage(1)
    setData(null)
    setError(null)
  }, [summaryKey])

  useEffect(() => {
    void load()
  }, [load])

  const title =
    data?.title ?? '客户明细'
  const countSuffix =
    data?.pagination?.total != null ? `（${data.pagination.total}）` : ''

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title={`${title}${countSuffix}`}
      subtitle={data?.formula}
      testId="buyer-summary-drawer"
      footer={
        data && data.pagination.total > data.pagination.pageSize ? (
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
        <div className="space-y-2 py-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-rose-50/80" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-dashed border-red-200 bg-red-50/50 py-12 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-full border border-red-200 bg-white px-4 py-1.5 text-xs text-red-700"
          >
            重试
          </button>
        </div>
      ) : data ? (
        <div className="animate-in fade-in space-y-3 duration-300">
          {data.items.length === 0 ? (
            <p className="py-12 text-center text-xs text-slate-400">
              {data.emptyMessage ?? '暂无客户'}
            </p>
          ) : (
            <ul className="space-y-2">
              {data.items.map((row) => {
                const blocked =
                  Boolean(row.isBlacklisted) || Number(row.qualityReturnCount ?? 0) >= 1
                return (
                  <li
                    key={String(row.buyerKey ?? row.buyerId)}
                    className={`rounded-xl border p-3 text-xs transition hover:shadow-sm ${
                      blocked ? 'border-red-100 bg-red-50/30' : 'border-rose-100 bg-white'
                    }`}
                  >
                    <BuyerDisplay
                      nickname={String(
                        row.buyerDisplayName ?? row.buyerNickname ?? row.nickname ?? '',
                      )}
                      identityCode={
                        String(row.buyerShortCode ?? row.buyerIdentityCode ?? '').trim() ||
                        undefined
                      }
                      buyerId={String(row.buyerId)}
                      isBlacklisted={blocked}
                    />
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
                      <span className="inline-flex items-center gap-0.5">
                        赚到金额 {formatMoney(earnedAmountFromRow(row))}
                        <MetricInfoTooltip text={getMetricExplain('earnedAmount')} />
                      </span>
                    </div>
                    {onViewBuyerOrders ? (
                      <button
                        type="button"
                        className="mt-2 text-rose-600 hover:underline"
                        onClick={() => onViewBuyerOrders(rowToDrawerBuyer(row))}
                      >
                        查看订单
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {data.pagination.total <= data.pagination.pageSize && data.pagination.total > 0 ? (
            <Pagination
              page={data.pagination.page}
              total={data.pagination.total}
              pageSize={data.pagination.pageSize}
              onPage={setPage}
            />
          ) : null}
        </div>
      ) : null}
    </BoardDrawerShell>
  )
}
