import React, { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { centToDisplayYuan, fetchBossBillOrders, type BossBillOrderView } from '../../lib/boss-dashboard-api'

interface Props {
  open: boolean
  onClose: () => void
}

const SHOP_OPTIONS = [
  { key: '', label: '四店合计' },
  { key: 'shiyuju', label: '拾玉居和田玉' },
  { key: 'hetianyayu', label: '和田雅玉' },
  { key: 'xiangyu', label: '祥钰珠宝' },
  { key: 'xyxiangyu', label: 'XY祥钰珠宝' },
]

export const BossBillDrawer: React.FC<Props> = ({ open, onClose }) => {
  const [status, setStatus] = useState<'pending' | 'settled'>('pending')
  const [shopKey, setShopKey] = useState('')
  const [items, setItems] = useState<BossBillOrderView[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchBossBillOrders({
        status,
        shopKey: shopKey || undefined,
        page,
        pageSize: 20,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [open, page, shopKey, status])

  useEffect(() => {
    if (!open) return
    void load()
  }, [load, open])

  useEffect(() => {
    setPage(1)
  }, [shopKey, status])

  if (!open) return null

  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
      <button type="button" className="flex-1" aria-label="关闭" onClick={onClose} />
      <aside className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">账单明细</h3>
            <p className="mt-0.5 text-xs text-slate-500">仅读取本地已同步数据</p>
          </div>
          <button
            type="button"
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <select
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            value={shopKey}
            onChange={(e) => setShopKey(e.target.value)}
          >
            {SHOP_OPTIONS.map((opt) => (
              <option key={opt.key || 'all'} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
            {(['pending', 'settled'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`rounded-md px-3 py-1 ${status === s ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                onClick={() => setStatus(s)}
              >
                {s === 'pending' ? '待结算' : '已结算'}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {loading ? <p className="text-sm text-slate-500">加载中…</p> : null}
          {error ? <p className="text-sm text-amber-600">{error}</p> : null}
          {!loading && !error && items.length === 0 ? (
            <p className="text-sm text-slate-500">暂无账单明细</p>
          ) : null}
          <div className="space-y-2">
            {items.map((row, idx) => (
              <div key={`${row.packageId ?? 'row'}-${idx}`} className="rounded-xl border border-slate-100 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{row.shopName}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">订单号 {row.packageId ?? '—'}</div>
                  </div>
                  <div className="shrink-0 font-semibold text-slate-900">
                    {centToDisplayYuan(row.expectedSettleAmountCent)}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                  <div>下单：{row.orderCreateTime ? row.orderCreateTime.slice(0, 16).replace('T', ' ') : '—'}</div>
                  <div>状态：{row.orderStatus ?? '—'}</div>
                  <div>预计结算：{row.expectedSettleTime ? row.expectedSettleTime.slice(0, 10) : '—'}</div>
                  <div>佣金：{centToDisplayYuan(row.platformCommissionCent)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
          <span className="text-slate-500">共 {total} 条</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <span className="text-slate-600">
              {page}/{totalPages}
            </span>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
