import React, { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'

export interface BuyerNickOrderSearchHit {
  orderNo: string
  displayOrderNo: string
  orderTime: string
  anchorName: string
  shopName: string
  sessionLabel: string | null
  buyerNickname: string
  buyerId: string
  productName: string
  payAmount: number
  refundAmount: number
  signedAmount: number
  orderStatus: string
  afterSaleStatus: string
  afterSaleReason: string
  statusText: string
}

interface SearchResult {
  keyword: string
  total: number
  items: BuyerNickOrderSearchHit[]
  message?: string
}

interface Props {
  /** 自定义区间起止；未选齐时不可搜 */
  startDate: string
  endDate: string
}

export const BuyerNickOrderSearch: React.FC<Props> = ({ startDate, endDate }) => {
  const { formatMoney } = useAmountDisplay()
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SearchResult | null>(null)

  const rangeReady = Boolean(startDate && endDate && startDate <= endDate)

  useEffect(() => {
    setResult(null)
    setError(null)
  }, [startDate, endDate])

  const runSearch = useCallback(async () => {
    const q = keyword.trim()
    if (!q) {
      setError('请输入买家昵称')
      setResult(null)
      return
    }
    if (!rangeReady) {
      setError('请先选择自定义起止日期')
      setResult(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        keyword: q,
        preset: 'custom',
        startDate,
        endDate,
      })
      const data = await apiRequest<SearchResult>(
        `/api/board/order-search-by-buyer-nick?${qs.toString()}`,
      )
      setResult(data)
      if (data.total === 0) {
        setError(data.message || '该自定义日期范围内未找到匹配昵称的订单')
      }
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, startDate, endDate, rangeReady])

  return (
    <div className="mt-2 border-t border-slate-100 pt-2.5">
      <p className="text-xs font-medium text-slate-700">按买家昵称查订单</p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        匹配所选自定义区间经营缓存中的买家昵称
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
          placeholder="输入买家昵称"
          disabled={!rangeReady || loading}
          className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!rangeReady || loading}
          onClick={() => void runSearch()}
          className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-40"
        >
          <Search size={12} />
          {loading ? '搜索中…' : '搜索'}
        </button>
      </div>

      {error && (!result || result.total === 0) ? (
        <p className="mt-1.5 text-[11px] text-amber-700">{error}</p>
      ) : null}
      {result?.message && result.total > 0 ? (
        <p className="mt-1.5 text-[11px] text-slate-500">{result.message}</p>
      ) : null}

      {result && result.items.length > 0 ? (
        <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
          {result.items.map((item, idx) => {
            const afterSale =
              item.afterSaleStatus && item.afterSaleStatus !== '—'
                ? item.afterSaleStatus
                : ''
            return (
              <article
                key={`${item.orderNo}-${item.orderTime}-${item.buyerId}-${idx}`}
                className="rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2 text-xs"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <p className="font-medium text-slate-900">
                    {item.buyerNickname}
                    <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                      {item.displayOrderNo || item.orderNo}
                    </span>
                  </p>
                  <p className="tabular-nums text-slate-800">{formatMoney(item.payAmount)}</p>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-600">
                  主播：{item.anchorName}
                  {item.shopName && item.shopName !== '—' ? ` · ${item.shopName}` : ''}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  场次：{item.sessionLabel || '未匹配到排班场次'}
                  <span className="mx-1 text-slate-300">|</span>
                  下单：{item.orderTime}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  商品：{item.productName}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  状态：{item.orderStatus || item.statusText || '—'}
                  {afterSale ? ` · 售后 ${afterSale}` : ''}
                  {item.refundAmount > 0 ? ` · 退款 ${formatMoney(item.refundAmount)}` : ''}
                </p>
              </article>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
