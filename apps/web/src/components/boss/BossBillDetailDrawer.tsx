import React, { useCallback, useEffect, useState } from 'react'
import {
  centToDisplayYuan,
  fetchBossBillOrders,
  type BossBillOrderRow,
} from '../../lib/boss-dashboard-api'
import { formatDataFreshnessTime } from '../../lib/data-freshness'
import { BoardDrawerShell } from '../board/BoardDrawerShell'

interface Props {
  open: boolean
  onClose: () => void
}

const SHOP_OPTIONS = [
  { key: '', label: '四店' },
  { key: 'shiyuju', label: '拾玉居和田玉' },
  { key: 'hetianyayu', label: '和田雅玉' },
  { key: 'xiangyu', label: '祥钰珠宝' },
  { key: 'xyxiangyu', label: 'XY祥钰珠宝' },
]

export const BossBillDetailDrawer: React.FC<Props> = ({ open, onClose }) => {
  const [shopKey, setShopKey] = useState('')
  const [status, setStatus] = useState<'pending' | 'settled'>('pending')
  const [items, setItems] = useState<BossBillOrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchBossBillOrders({
        shopKey: shopKey || undefined,
        status,
        page: 1,
        pageSize: 50,
      })
      setItems(res.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [shopKey, status])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title="账单明细"
      subtitle="只读本地数据库，不请求平台"
      scrollResetKey={`${shopKey}-${status}`}
      headerExtra={
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            value={shopKey}
            onChange={(e) => setShopKey(e.target.value)}
          >
            {SHOP_OPTIONS.map((o) => (
              <option key={o.key || 'all'} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-full border border-slate-200 p-0.5 text-xs">
            {[
              ['pending', '待结算'],
              ['settled', '已结算'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rounded-full px-3 py-1 ${
                  status === key ? 'bg-slate-900 text-white' : 'text-slate-600'
                }`}
                onClick={() => setStatus(key as 'pending' | 'settled')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {loading ? <p className="text-sm text-slate-500">加载中…</p> : null}
      {error ? <p className="text-sm text-amber-600">{error}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="text-sm text-slate-500">暂无明细</p>
      ) : (
        <div className="space-y-3">
          {items.map((row, idx) => (
            <div
              key={`${row.shopKey}-${row.packageId}-${idx}`}
              className="rounded-xl border border-slate-100 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{row.shopName}</span>
                <span className="text-xs text-slate-500">{row.settleStatus ?? '—'}</span>
              </div>
              <div className="mt-2 space-y-1 break-words text-xs text-slate-600">
                <div>订单号 {row.packageId ?? '—'}</div>
                <div>
                  下单时间{' '}
                  {row.orderCreateTime ? formatDataFreshnessTime(row.orderCreateTime) : '—'}
                </div>
                <div>订单状态 {row.orderStatus ?? '—'}</div>
                <div>预计待结算 {centToDisplayYuan(row.expectedSettleAmountCent)}</div>
                <div>
                  预计结算时间{' '}
                  {row.expectedSettleTime ? formatDataFreshnessTime(row.expectedSettleTime) : '—'}
                </div>
                <div>
                  实际结算时间{' '}
                  {row.actualSettleTime ? formatDataFreshnessTime(row.actualSettleTime) : '—'}
                </div>
                <div>平台佣金 {centToDisplayYuan(row.platformCommissionCent)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </BoardDrawerShell>
  )
}
