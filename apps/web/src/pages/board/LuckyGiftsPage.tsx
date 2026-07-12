import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckSquare, ChevronDown, Copy, Gift, Info, Loader2, RefreshCw, Square, Truck, X } from 'lucide-react'
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
  syncStatus?: string | null
  syncStatusLabel?: string | null
  fetchedDrawCount?: number
  fetchedWinnerCount?: number
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
    withDataShopCount?: number
    confirmedEmptyShopCount?: number
    ambiguousEmptyShopCount?: number
    partialSuccessShopCount?: number
    failedShops: Array<{ shopName: string; error: string; syncStatus?: string }>
    newDrawCount: number
    newWinnerCount?: number
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

const FILTER_BTN =
  'inline-flex h-9 items-center rounded-lg border px-3 text-sm transition-colors'
const FILTER_BTN_ACTIVE = 'border-slate-800 bg-slate-800 text-white'
const FILTER_BTN_IDLE = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
const ACTION_BTN =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50'
const ACTION_BTN_PRIMARY = 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm text-white hover:bg-emerald-700'

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

function shopPillClass(active: boolean): string {
  return [
    'inline-flex min-h-[3rem] min-w-[8.5rem] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-colors',
    active ? 'border-slate-800 bg-slate-800 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300',
  ].join(' ')
}

function LuckyGiftRow(props: {
  item: LuckyGiftItem
  checked: boolean
  onToggle: () => void
  expanded: boolean
  onToggleExpand: () => void
  canViewPii: boolean
  canMutate: boolean
  isSuperAdmin: boolean
  onCopy: () => void
  onShip: () => void
  onUndo: () => void
}) {
  const { item, checked, expanded } = props
  const showAddress = item.shipmentStatus !== 'no_address'
  const freight = item.freightLabel?.trim() || '到付'

  return (
    <article
      className={`rounded-2xl border bg-white shadow-sm ${
        item.shipmentStatus === 'no_address' || item.shipmentStatus === 'incomplete_address'
          ? 'border-amber-100'
          : 'border-slate-100'
      }`}
    >
      <div className="flex gap-3 p-4 sm:gap-4">
        <div className="flex shrink-0 items-start pt-1">
          <input
            type="checkbox"
            checked={checked}
            onChange={props.onToggle}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
            aria-label="选择此条"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">{item.giftName || '直播福袋'}</h3>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{item.liveAccountName}</span>
              <span className={`rounded-md border px-2 py-0.5 text-xs ${statusTone(item.shipmentStatus)}`}>
                {item.shipmentStatusLabel}
              </span>
              {freight && (
                <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500">{freight}</span>
              )}
            </div>

            <div className="space-y-1 text-sm text-slate-700">
              <p>
                <span className="text-slate-500">中奖人</span>{' '}
                {item.winnerNickname || '—'}
                {item.redId ? (
                  <span className="ml-2 text-slate-500">
                    小红书号 {item.redId}
                  </span>
                ) : null}
              </p>
              {showAddress ? (
                <>
                  <p>
                    <span className="text-slate-500">收件人</span> {item.recipientName || '—'}
                    <span className="mx-2 text-slate-300">|</span>
                    <span className="text-slate-500">手机</span> {item.recipientPhone || '—'}
                  </p>
                  <p className="break-all leading-relaxed text-slate-800">{item.fullAddress || '—'}</p>
                  {item.addressMissing?.length > 0 && item.shipmentStatus !== 'shipped' && (
                    <p className="text-amber-800">地址不完整：{item.addressMissing.join('、')}</p>
                  )}
                </>
              ) : (
                <p className="text-amber-800">中奖人尚未填写地址</p>
              )}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              {item.winTime && <span>中奖 {formatDateTime(item.winTime)}</span>}
              {item.shipDeadlineHint && item.shipDeadlineHint !== '—' && (
                <span>{item.shipDeadlineHint}</span>
              )}
              {item.addressDeadlineHint && <span>{item.addressDeadlineHint}</span>}
            </div>

            <button
              type="button"
              onClick={props.onToggleExpand}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? '收起更多信息' : '展开更多信息'}
            </button>

            {expanded && (
              <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <p>福袋编号 {item.luckyDrawId}</p>
                {item.roomId && <p>直播间编号 {item.roomId}</p>}
                {item.firstAddressSeenAt && (
                  <p>系统首次发现地址 {formatDateTime(item.firstAddressSeenAt)}</p>
                )}
                {item.markedShippedAt && <p>系统已记录发货 {formatDateTime(item.markedShippedAt)}</p>}
                {(item.courierCompany || item.trackingNo || item.trackingPending) && (
                  <p>
                    物流 {item.courierCompany || '—'} /{' '}
                    {item.trackingPending ? '单号待补' : item.trackingNo || '—'}
                  </p>
                )}
                {item.shipmentNote && <p>备注 {item.shipmentNote}</p>}
                {item.shippingStatusSourceLabel && (
                  <p>状态来源 {item.shippingStatusSourceLabel}</p>
                )}
                {item.rawAddress && (
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[11px]">
                    {JSON.stringify(item.rawAddress, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-row items-center gap-2 sm:w-28 sm:flex-col sm:justify-center">
            <button type="button" onClick={props.onCopy} className={`${ACTION_BTN} w-full justify-center`}>
              <Copy className="h-3.5 w-3.5" />
              复制
            </button>
            {props.canMutate && item.shipmentStatus === 'pending' && item.addressComplete && (
              <button type="button" onClick={props.onShip} className={`${ACTION_BTN_PRIMARY} w-full justify-center`}>
                <Truck className="h-3.5 w-3.5" />
                标记已发
              </button>
            )}
            {props.canMutate &&
              props.isSuperAdmin &&
              item.shipmentStatus === 'shipped' &&
              item.shippingStatusSource === 'local' && (
                <button
                  type="button"
                  onClick={props.onUndo}
                  className={`${ACTION_BTN} w-full justify-center text-xs`}
                >
                  撤销
                </button>
              )}
          </div>
        </div>
      </div>
    </article>
  )
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
  const [showSyncDetails, setShowSyncDetails] = useState(false)

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
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set())

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

  const sortedShops = useMemo(
    () =>
      (summary?.shops ?? [])
        .slice()
        .sort(
          (a, b) =>
            SHOP_ORDER.indexOf(a.shopKey as (typeof SHOP_ORDER)[number]) -
            SHOP_ORDER.indexOf(b.shopKey as (typeof SHOP_ORDER)[number]),
        ),
    [summary?.shops],
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
    setMessage(ok ? `已复制 ${items.length} 条地址信息` : '复制失败')
  }

  async function handleCopyOne(item: LuckyGiftItem) {
    if (!canViewPii) {
      setMessage('当前账号无权复制完整地址')
      return
    }
    if (!(item.shipmentStatus === 'pending' && item.addressComplete)) {
      const text = buildLuckyGiftAuditCopyText([item])
      const ok = await copyTextToClipboard(text)
      setMessage(ok ? '已复制该条信息' : '复制失败')
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
      const data = await apiRequest<SummaryPayload['sync'] & { shops?: ShopStat[] }>(
        '/api/board/lucky-gifts/sync',
        { method: 'POST' },
      )
      setMessage(
        `同步完成：拉到 ${data.withDataShopCount ?? 0} 店，新增福袋 ${data.newDrawCount}，新增地址 ${data.newAddressCount}`,
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
      { key: 'todayNew', label: '今日新同步', value: summary?.todayNew ?? 0 },
      { key: 'allWinners', label: '全部中奖记录', value: summary?.totalWinners ?? 0 },
    ]

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8" data-testid="lucky-gifts-page">
      {/* 1. 顶部标题区 */}
      <section className="space-y-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
              <Gift className="h-6 w-6 text-rose-500" />
              福袋发货
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              四店直播福袋统一管理｜地址可直接复制给快递员
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => void handleSyncAll()}
                disabled={syncing}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                立即同步四店
              </button>
            )}
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
            >
              刷新本地
            </button>
          </div>
        </div>

        {summary && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>最近同步 {formatDateTime(summary.sync.lastSyncedAt)}</span>
            <span>·</span>
            <span>拉到数据 {summary.sync.withDataShopCount ?? 0} 店</span>
            <span>·</span>
            <span>新增福袋 {summary.sync.newDrawCount}</span>
            <span>·</span>
            <span>新增地址 {summary.sync.newAddressCount}</span>
            <button
              type="button"
              onClick={() => setShowSyncDetails(true)}
              className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700"
            >
              <Info className="h-3.5 w-3.5" />
              同步详情
            </button>
          </div>
        )}
      </section>

      {/* 2. 总览区 */}
      <section className="grid grid-flow-col auto-cols-[minmax(7.5rem,1fr)] gap-3 overflow-x-auto pb-1 sm:grid-flow-row sm:grid-cols-5 sm:overflow-visible sm:pb-0">
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
            className="flex min-h-[5.5rem] flex-col justify-center rounded-2xl border border-slate-100 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300"
          >
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{c.value}</div>
          </button>
        ))}
      </section>

      {/* 3. 店铺二级汇总 */}
      <section className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShopKey('all')} className={shopPillClass(shopKey === 'all')}>
          <span className="text-sm font-medium">全部四店</span>
        </button>
        {sortedShops.map((s) => (
          <button
            key={s.shopKey}
            type="button"
            onClick={() => setShopKey(s.shopKey)}
            className={shopPillClass(shopKey === s.shopKey)}
            title={
              s.syncStatusLabel || s.lastError
                ? `${s.syncStatusLabel ?? ''}${s.lastError ? ` · ${s.lastError}` : ''}`
                : undefined
            }
          >
            <span className="text-sm font-medium leading-tight">{s.shopName}</span>
            <span className={`mt-0.5 text-[11px] leading-snug ${shopKey === s.shopKey ? 'text-slate-200' : 'text-slate-500'}`}>
              活动 {s.drawCount}｜待发 {s.pending}｜缺地址 {s.noAddress}
            </span>
          </button>
        ))}
      </section>

      {/* 4. 筛选 / 操作区 */}
      <section className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
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
              className={`${FILTER_BTN} ${status === k ? FILTER_BTN_ACTIVE : FILTER_BTN_IDLE}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索昵称、收件人、手机、地址或福袋名"
            className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm"
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
                className={`${FILTER_BTN} ${dateRange === k ? FILTER_BTN_ACTIVE : FILTER_BTN_IDLE}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {dateRange === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 px-2"
            />
            <span>至</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 px-2"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={() => void handleCopyPendingAll()} className={ACTION_BTN}>
            <Copy className="h-3.5 w-3.5" />
            复制全部待发货地址
          </button>
          <button type="button" onClick={() => void handleCopySelected()} className={ACTION_BTN}>
            复制所选
          </button>
          <button type="button" onClick={() => void handleCopyAuditAll()} className={ACTION_BTN}>
            复制当前结果地址（含缺失标记）
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set(items.map((i) => i.id)))}
            className={ACTION_BTN}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            全选当前结果
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className={ACTION_BTN}>
            <Square className="h-3.5 w-3.5" />
            取消全选
          </button>
          {canMutate && (
            <button
              type="button"
              onClick={() => {
                setBatchShip(true)
                setShipModalId('batch')
              }}
              className={ACTION_BTN_PRIMARY}
            >
              <Truck className="h-3.5 w-3.5" />
              标记所选已发
            </button>
          )}
          {isSuperAdmin && shopKey !== 'all' && (
            <button type="button" onClick={() => void handleSyncShop(shopKey)} className={ACTION_BTN}>
              重新同步本店
            </button>
          )}
        </div>
      </section>

      {message && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</div>
      )}

      {/* 5. 列表区 */}
      <section className="space-y-3">
        {!loading && items.length > 0 && (
          <p className="text-xs text-slate-400">当前 {total} 条记录</p>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取本地福袋数据…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-16 text-center text-sm text-slate-500">
            当前没有符合条件的记录。可以点右上角「立即同步四店」重新拉数据。
          </div>
        ) : (
          items.map((item) => (
            <LuckyGiftRow
              key={item.id}
              item={item}
              checked={selected.has(item.id)}
              onToggle={() => {
                setSelected((prev) => {
                  const next = new Set(prev)
                  if (next.has(item.id)) next.delete(item.id)
                  else next.add(item.id)
                  return next
                })
              }}
              expanded={expandedDetails.has(item.id)}
              onToggleExpand={() => {
                setExpandedDetails((prev) => {
                  const next = new Set(prev)
                  if (next.has(item.id)) next.delete(item.id)
                  else next.add(item.id)
                  return next
                })
              }}
              canViewPii={canViewPii}
              canMutate={canMutate}
              isSuperAdmin={isSuperAdmin}
              onCopy={() => void handleCopyOne(item)}
              onShip={() => {
                setBatchShip(false)
                setShipModalId(item.id)
              }}
              onUndo={() => void undoShip(item.id)}
            />
          ))
        )}
      </section>

      {showSyncDetails && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">同步详情</h3>
              <button type="button" onClick={() => setShowSyncDetails(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              <p>最近同步 {formatDateTime(summary.sync.lastSyncedAt)}</p>
              <p>拉到数据 {summary.sync.withDataShopCount ?? 0} 店</p>
              <p>确认无数据 {summary.sync.confirmedEmptyShopCount ?? 0} 店</p>
              <p>尚不能确认为空 {summary.sync.ambiguousEmptyShopCount ?? 0} 店</p>
              <p>部分成功 {summary.sync.partialSuccessShopCount ?? 0} 店</p>
              <p>失败 {summary.sync.failedShopCount} 店</p>
              <p>新增福袋 {summary.sync.newDrawCount} · 新增中奖人 {summary.sync.newWinnerCount ?? 0} · 新增地址 {summary.sync.newAddressCount}</p>
              {summary.sync.failedShops?.length > 0 && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                  {summary.sync.failedShops.map((s) => (
                    <p key={s.shopName}>{s.shopName}：{s.error}</p>
                  ))}
                </div>
              )}
              <div className="border-t border-slate-100 pt-2">
                {sortedShops.map((s) => (
                  <p key={s.shopKey} className="text-xs text-slate-500">
                    {s.shopName}：{s.syncStatusLabel || '—'}
                    {s.lastSyncedAt ? ` · ${formatDateTime(s.lastSyncedAt)}` : ''}
                    {s.lastError ? ` · ${s.lastError}` : ''}
                  </p>
                ))}
              </div>
            </div>
          </div>
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
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">运费方式：到付（只读）</div>
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
