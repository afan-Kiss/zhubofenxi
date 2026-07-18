import React, { useCallback, useState } from 'react'
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
  preset: string
  startDate: string
  endDate: string
}

export const BuyerNickOrderSearch: React.FC<Props> = ({ preset, startDate, endDate }) => {
  const { formatMoney } = useAmountDisplay()
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SearchResult | null>(null)

  const runSearch = useCallback(async () => {
    const q = keyword.trim()
    if (!q) {
      setError('请输入买家昵称')
      setResult(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        keyword: q,
        preset,
        startDate,
        endDate,
      })
      const data = await apiRequest<SearchResult>(
        `/api/board/order-search-by-buyer-nick?${qs.toString()}`,
      )
      setResult(data)
      if (data.total === 0) {
        setError(data.message || '当前日期范围内未找到匹配订单')
      }
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, preset, startDate, endDate])

  return (
    <div className="mt-4 border-t border-rose-50 pt-3">
      <p className="text-sm font-medium text-slate-800">按买家昵称查订单</p>
      <p className="mt-0.5 text-xs text-slate-500">
        在当前日期范围内搜索，可看到对应主播、场次与订单详情
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
          placeholder="输入买家昵称"
          className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => void runSearch()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
        >
          <Search size={14} />
          {loading ? '搜索中…' : '搜索'}
        </button>
      </div>

      {error && (!result || result.total === 0) ? (
        <p className="mt-2 text-xs text-amber-700">{error}</p>
      ) : null}
      {result?.message && result.total > 0 ? (
        <p className="mt-2 text-xs text-slate-500">{result.message}</p>
      ) : null}

      {result && result.items.length > 0 ? (
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {result.items.map((item, idx) => {
            const afterSale =
              item.afterSaleStatus && item.afterSaleStatus !== '—'
                ? item.afterSaleStatus
                : ''
            return (
            <article
              key={`${item.orderNo}-${item.orderTime}-${item.buyerId}-${idx}`}
              className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-medium text-slate-900">
                  {item.buyerNickname}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {item.displayOrderNo || item.orderNo}
                  </span>
                </p>
                <p className="tabular-nums text-slate-800">{formatMoney(item.payAmount)}</p>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                主播：{item.anchorName}
                {item.shopName && item.shopName !== '—' ? ` · ${item.shopName}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                场次：{item.sessionLabel || '未匹配到排班场次'}
                <span className="mx-1.5 text-slate-300">|</span>
                下单：{item.orderTime}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">商品：{item.productName}</p>
              <p className="mt-0.5 text-xs text-slate-500">
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
