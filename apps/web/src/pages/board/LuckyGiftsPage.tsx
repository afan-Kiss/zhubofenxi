import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckSquare, Copy, Gift, Loader2, RefreshCw, Square, Truck } from 'lucide-react'
import { apiRequest } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'
import {
  buildLuckyGiftAuditCopyText,
  buildLuckyGiftShipCopyText,
  copyTextToClipboard,
} from '../../lib/lucky-gift-copy'

type StatusFilter = 'todo' | 'pending' | 'no_address' | 'incomplete_address' | 'shipped' | 'all'
type DateRange = 'today' | '7d' | '30d' | 'custom' | 'all'

interface ShopStat {
  shopKey: string
  shopName: string
  liveAccountId: string | null
  pending: number
  noAddress: number
  incompleteAddress: number
  shipped: number
  winnerCount: number
  drawCount: number
  lastSyncedAt: string | null
  lastError: string | null
}

interface SummaryPayload {
  pending: number
  noAddress: number
  incompleteAddress: number
  shipped: number
  todayNew: number
  totalWinners: number
  totalDraws: number
  todo: number
  sync: {
    lastSyncedAt: string | null
    successShopCount: number
    failedShopCount: number
    failedShops: Array<{ shopName: string; error: string }>
    newDrawCount: number
    newAddressCount: number
    statusChangeCount: number
  }
  shops: ShopStat[]
}

interface LuckyGiftItem {
  id: string
  liveAccountId: string
  liveAccountName: string
  luckyDrawId: string
  roomId: string
  giftName: string
  winnerNickname: string
  redId: string | null
  recipientName: string | null
  recipientPhone: string | null
  fullAddress: string | null
  hasAddress: boolean
  addressComplete: boolean
  addressMissing: string[]
  firstAddressSeenAt: string | null
  winTime: string | null
  winDayN: number | null
  addressDeadlineHint: string | null
  shipDeadlineHint: string
  shipmentStatus: string
  shipmentStatusLabel: string
  shippingStatusSource: string
  shippingStatusSourceLabel: string
  freightLabel: string
  courierCompany: string | null
  trackingNo: string | null
  markedShippedAt: string | null
  shipmentNote: string | null
  trackingPending: boolean
  rawAddress?: {
    province: string | null
    city: string | null
    district: string | null
    detail: string | null
  }
}

const SHOP_ORDER = ['shiyuju', 'hetianyayu', 'xiangyu', 'xyxiangyu'] as const

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function statusTone(status: string): string {
  if (status === 'pending') return 'bg-sky-50 text-sky-700 border-sky-200'
  if (status === 'no_address' || status === 'incomplete_address')
    return 'bg-amber-50 text-amber-800 border-amber-200'
  if (status === 'shipped') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-slate-50 text-slate-600 border-slate-200'
}

export const LuckyGiftsPage: React.FC = () => {
  const { user, mode } = useAuth()
  const isSuperAdmin = user?.role === 'super_admin'
  const canMutate =
    mode === 'session' &&
    (user?.role === 'super_admin' || user?.role === 'boss' || user?.role === 'staff')
  const canViewPii =
    user?.role === 'super_admin' || user?.role === 'boss' || user?.role === 'staff'

  const [summary, setSummary] = useState<SummaryPayload | null>(null)
  const [items, setItems] = useState<LuckyGiftItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [shopKey, setShopKey] = useState<string>('all')
  const [status, setStatus] = useState<StatusFilter>('todo')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [shipModalId, setShipModalId] = useState<string | null>(null)
  const [batchShip, setBatchShip] = useState(false)
  const [courier, setCourier] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const [note, setNote] = useState('')
  const [expandedRaw, setExpandedRaw] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (shopKey !== 'all') qs.set('accountId', shopKey)
      qs.set('status', status)
      qs.set('dateRange', dateRange)
      if (dateRange === 'custom') {
        if (startDate) qs.set('startDate', startDate)
        if (endDate) qs.set('endDate', endDate)
      }
      if (keyword.trim()) qs.set('keyword', keyword.trim())
      qs.set('page', '1')
      qs.set('pageSize', '100')

      const [sum, list] = await Promise.all([
        apiRequest<SummaryPayload>('/api/board/lucky-gifts/summary'),
        apiRequest<{ items: LuckyGiftItem[]; total: number; canViewPii: boolean }>(
          `/api/board/lucky-gifts?${qs.toString()}`,
        ),
      ])
      setSummary(sum)
      setItems(list.items)
      setTotal(list.total)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [shopKey, status, dateRange, startDate, endDate, keyword])

  useEffect(() => {
    void load()
  }, [load])

  const pendingCopyItems = useMemo(
    () => items.filter((i) => i.shipmentStatus === 'pending' && i.addressComplete),
    [items],
  )

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.id)),
    [items, selected],
  )

  async function handleCopyPendingAll() {
    if (!canViewPii) {
      setMessage('当前账号无权复制完整地址')
      return
    }
    const text = buildLuckyGiftShipCopyText(pendingCopyItems)
    const ok = await copyTextToClipboard(text)
    setMessage(ok ? `已复制 ${pendingCopyItems.length} 个待发福袋地址` : '复制失败，请手动选择文本')
  }

  async function handleCopySelected() {
    if (!canViewPii) {
      setMessage('当前账号无权复制完整地址')
      return
    }
    const shipable = selectedItems.filter((i) => i.shipmentStatus === 'pending' && i.addressComplete)
    const text = buildLuckyGiftShipCopyText(shipable)
    const ok = await copyTextToClipboard(text)
    setMessage(ok ? `已复制 ${shipable.length} 个待发福袋地址` : '复制失败')
  }

  async function handleCopyAuditAll() {
    if (!canViewPii) {
      setMessage('当前账号无权复制完整地址')
      return
    }
    const text = buildLuckyGiftAuditCopyText(items)
    const ok = await copyTextToClipboard(text)
    setMessage(ok ? `已复制内部核对清单 ${items.length} 条（含未填地址）` : '复制失败')
  }

  async function handleCopyOne(item: LuckyGiftItem) {
    if (!canViewPii) {
      setMessage('当前账号无权复制完整地址')
      return
    }
    if (!(item.shipmentStatus === 'pending' && item.addressComplete)) {
      const text = buildLuckyGiftAuditCopyText([item])
      const ok = await copyTextToClipboard(text)
      setMessage(ok ? '已复制该条核对信息' : '复制失败')
      return
    }
    const text = buildLuckyGiftShipCopyText([item])
    const ok = await copyTextToClipboard(text)
    setMessage(ok ? '已复制这一单' : '复制失败')
  }

  async function handleSyncAll() {
    if (!isSuperAdmin) return
    setSyncing(true)
    setMessage(null)
    try {
      const data = await apiRequest<{
        successShopCount: number
        failedShopCount: number
        newDrawCount: number
        newAddressCount: number
      }>('/api/board/lucky-gifts/sync', { method: 'POST' })
      setMessage(
        `同步完成：成功 ${data.successShopCount} 店，失败 ${data.failedShopCount} 店，新增福袋 ${data.newDrawCount}，新增地址 ${data.newAddressCount}`,
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败')
    } finally {
      setSyncing(false)
    }
  }

  async function handleSyncShop(key: string) {
    if (!isSuperAdmin) return
    setSyncing(true)
    try {
      await apiRequest(`/api/board/lucky-gifts/sync/${key}`, { method: 'POST' })
      setMessage(`已重新同步 ${key}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '单店同步失败')
    } finally {
      setSyncing(false)
    }
  }

  async function submitShip() {
    if (!canMutate) return
    try {
      if (batchShip) {
        const ids = [...selected].filter((id) => {
          const it = items.find((x) => x.id === id)
          return it?.shipmentStatus === 'pending' && it.addressComplete
        })
        await apiRequest('/api/board/lucky-gifts/shipments/batch', {
          method: 'POST',
          body: JSON.stringify({
            winnerIds: ids,
            courierCompany: courier || null,
            trackingNo: trackingNo || null,
            note: note || null,
          }),
        })
        setMessage(`已批量标记 ${ids.length} 条为已发货`)
      } else if (shipModalId) {
        await apiRequest(`/api/board/lucky-gifts/winners/${shipModalId}/shipment`, {
          method: 'PATCH',
          body: JSON.stringify({
            courierCompany: courier || null,
            trackingNo: trackingNo || null,
            note: note || null,
          }),
        })
        setMessage('已标记发货')
      }
      setShipModalId(null)
      setBatchShip(false)
      setCourier('')
      setTrackingNo('')
      setNote('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '标记发货失败')
    }
  }

  async function undoShip(id: string) {
    if (!canMutate || !isSuperAdmin) return
    try {
      await apiRequest(`/api/board/lucky-gifts/winners/${id}/shipment`, {
        method: 'PATCH',
        body: JSON.stringify({ undo: true }),
      })
      setMessage('已撤销发货标记')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销失败')
    }
  }

  const summaryCards: Array<{ key: StatusFilter | 'todayNew' | 'allWinners'; label: string; value: number }> =
    [
      { key: 'pending', label: '待发货', value: summary?.pending ?? 0 },
      { key: 'no_address', label: '未填地址', value: summary?.noAddress ?? 0 },
      { key: 'shipped', label: '已发货', value: summary?.shipped ?? 0 },
      { key: 'todayNew', label: '今日新增', value: summary?.todayNew ?? 0 },
      { key: 'allWinners', label: '全部福袋', value: summary?.totalWinners ?? 0 },
    ]

  return (
    <div className="space-y-4" data-testid="lucky-gifts-page">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Gift className="h-5 w-5 text-rose-500" />
            福袋发货
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            四店直播福袋统一管理｜全部到付｜地址可直接复制给快递员
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => void handleSyncAll()}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              立即同步四店
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            刷新本地
          </button>
        </div>
      </div>

      {summary && (
        <div className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">
          最近同步：{formatDateTime(summary.sync.lastSyncedAt)}｜成功{' '}
          {summary.sync.successShopCount} 店｜失败 {summary.sync.failedShopCount} 店｜新增福袋{' '}
          {summary.sync.newDrawCount}｜新增地址 {summary.sync.newAddressCount}｜状态变化{' '}
          {summary.sync.statusChangeCount}
          {summary.sync.failedShops?.length > 0 && (
            <span className="ml-2 text-amber-700">
              失败：
              {summary.sync.failedShops.map((s) => `${s.shopName}（${s.error}）`).join('；')}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {summaryCards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              if (c.key === 'todayNew') {
                setDateRange('today')
                setStatus('all')
              } else if (c.key === 'allWinners') {
                setStatus('all')
                setDateRange('all')
              } else {
                setStatus(c.key)
              }
            }}
            className="rounded-2xl border border-slate-100 bg-white px-3 py-3 text-left shadow-sm hover:border-slate-300"
          >
            <div className="text-[11px] text-slate-500">{c.label}</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{c.value}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShopKey('all')}
          className={`rounded-full border px-3 py-1.5 text-xs ${
            shopKey === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white'
          }`}
        >
          全部四店
        </button>
        {(summary?.shops ?? [])
          .slice()
          .sort((a, b) => SHOP_ORDER.indexOf(a.shopKey as (typeof SHOP_ORDER)[number]) - SHOP_ORDER.indexOf(b.shopKey as (typeof SHOP_ORDER)[number]))
          .map((s) => (
            <button
              key={s.shopKey}
              type="button"
              onClick={() => setShopKey(s.shopKey)}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                shopKey === s.shopKey
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white'
              }`}
            >
              {s.shopName}
              <span className="ml-1 opacity-80">
                待发 {s.pending}｜未填地址 {s.noAddress}｜已发 {s.shipped}
              </span>
            </button>
          ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['todo', '待处理'],
            ['pending', '待发货'],
            ['no_address', '未填地址'],
            ['shipped', '已发货'],
            ['all', '全部'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setStatus(k)}
            className={`rounded-lg border px-3 py-1.5 text-xs ${
              status === k ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-white p-3 sm:flex-row sm:items-center">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索昵称/收件人/手机/地址/福袋名/福袋ID/直播间ID"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['today', '今天'],
              ['7d', '近7天'],
              ['30d', '近30天'],
              ['all', '全部历史'],
              ['custom', '自定义'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setDateRange(k)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                dateRange === k ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {dateRange === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1"
            />
            <span>至</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1"
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleCopyPendingAll()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50"
        >
          <Copy className="h-3.5 w-3.5" />
          复制全部待发地址
        </button>
        <button
          type="button"
          onClick={() => void handleCopySelected()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50"
        >
          复制所选
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set(items.map((i) => i.id)))}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
        >
          <CheckSquare className="h-3.5 w-3.5" />
          全选当前结果
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
        >
          <Square className="h-3.5 w-3.5" />
          取消全选
        </button>
        <button
          type="button"
          onClick={() => void handleCopyAuditAll()}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          复制全部（含未填地址）
        </button>
        {canMutate && (
          <button
            type="button"
            onClick={() => {
              setBatchShip(true)
              setShipModalId('batch')
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white"
          >
            <Truck className="h-3.5 w-3.5" />
            标记所选已发
          </button>
        )}
        {isSuperAdmin && shopKey !== 'all' && (
          <button
            type="button"
            onClick={() => void handleSyncShop(shopKey)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
          >
            重新同步本店
          </button>
        )}
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取本地福袋数据…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          当前筛选无记录。超级管理员可点击「立即同步四店」拉取平台数据。
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-slate-500">共 {total} 条中奖记录（按中奖人计）</div>
          {items.map((item) => {
            const checked = selected.has(item.id)
            const warn = item.shipmentStatus === 'no_address' || item.shipmentStatus === 'incomplete_address'
            return (
              <div
                key={item.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm ${
                  warn ? 'border-amber-200 bg-amber-50/40' : 'border-slate-100'
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(item.id)) next.delete(item.id)
                            else next.add(item.id)
                            return next
                          })
                        }}
                      />
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {item.liveAccountName}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(item.shipmentStatus)}`}
                      >
                        {item.shipmentStatusLabel}
                      </span>
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs text-violet-700">
                        到付
                      </span>
                      <span className="text-xs text-slate-500">{formatDateTime(item.winTime)}</span>
                      <span className="text-[11px] text-slate-400">{item.shippingStatusSourceLabel}</span>
                    </div>

                    <div className="text-base font-medium text-slate-900 break-all">{item.giftName || '直播福袋'}</div>
                    <div className="grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
                      <div>中奖人：{item.winnerNickname || '—'}</div>
                      <div>小红书号：{item.redId || '—'}</div>
                      {item.shipmentStatus === 'no_address' ? (
                        <div className="sm:col-span-2 text-amber-800">中奖人尚未填写地址</div>
                      ) : (
                        <>
                          <div className="break-all">收件人：{item.recipientName || '—'}</div>
                          <div className="break-all">手机号：{item.recipientPhone || '—'}</div>
                          <div className="sm:col-span-2 break-all whitespace-pre-wrap">
                            收货地址：{item.fullAddress || '—'}
                          </div>
                        </>
                      )}
                      {item.addressMissing?.length > 0 && item.shipmentStatus !== 'shipped' && (
                        <div className="sm:col-span-2 text-amber-800">
                          缺少：{item.addressMissing.join('、')}
                        </div>
                      )}
                      {item.addressDeadlineHint && (
                        <div className="sm:col-span-2 text-xs text-amber-700">{item.addressDeadlineHint}</div>
                      )}
                      <div className="sm:col-span-2 text-xs text-slate-500">{item.shipDeadlineHint}</div>
                      {item.firstAddressSeenAt && (
                        <div className="sm:col-span-2 text-xs text-slate-400">
                          系统首次发现地址：{formatDateTime(item.firstAddressSeenAt)}
                        </div>
                      )}
                      <div className="break-all text-xs text-slate-500">福袋ID：{item.luckyDrawId}</div>
                      <div className="break-all text-xs text-slate-500">直播间ID：{item.roomId || '—'}</div>
                      {(item.courierCompany || item.trackingNo || item.trackingPending) && (
                        <div className="sm:col-span-2 text-sm">
                          物流：{item.courierCompany || '—'} /{' '}
                          {item.trackingPending ? '物流单号待补' : item.trackingNo || '—'}
                        </div>
                      )}
                      {item.markedShippedAt && (
                        <div className="text-xs text-slate-500">
                          标记发货：{formatDateTime(item.markedShippedAt)}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="text-xs text-slate-400 underline"
                      onClick={() =>
                        setExpandedRaw((prev) => {
                          const next = new Set(prev)
                          if (next.has(item.id)) next.delete(item.id)
                          else next.add(item.id)
                          return next
                        })
                      }
                    >
                      {expandedRaw.has(item.id) ? '收起平台原始地址字段' : '展开平台原始地址字段'}
                    </button>
                    {expandedRaw.has(item.id) && item.rawAddress && (
                      <pre className="overflow-x-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                        {JSON.stringify(item.rawAddress, null, 2)}
                      </pre>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-row gap-2 lg:flex-col">
                    <button
                      type="button"
                      onClick={() => void handleCopyOne(item)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50"
                    >
                      复制这一单
                    </button>
                    {canMutate && item.shipmentStatus === 'pending' && item.addressComplete && (
                      <button
                        type="button"
                        onClick={() => {
                          setBatchShip(false)
                          setShipModalId(item.id)
                        }}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white"
                      >
                        标记已发
                      </button>
                    )}
                    {canMutate &&
                      isSuperAdmin &&
                      item.shipmentStatus === 'shipped' &&
                      item.shippingStatusSource === 'local' && (
                        <button
                          type="button"
                          onClick={() => void undoShip(item.id)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600"
                        >
                          撤销误标记
                        </button>
                      )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {shipModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {batchShip ? '批量标记已发' : '标记已发'}
            </h3>
            <p className="mt-1 text-xs text-slate-500">快递员已收走但暂无单号时，也可先标记已发。</p>
            <div className="mt-3 space-y-2">
              <label className="block text-xs text-slate-500">
                物流公司（可选）
                <input
                  value={courier}
                  onChange={(e) => setCourier(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-slate-500">
                物流单号（可选）
                <input
                  value={trackingNo}
                  onChange={(e) => setTrackingNo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-slate-500">
                备注（可选）
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                运费方式：到付（只读）
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                onClick={() => {
                  setShipModalId(null)
                  setBatchShip(false)
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white"
                onClick={() => void submitShip()}
              >
                确认已发
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
