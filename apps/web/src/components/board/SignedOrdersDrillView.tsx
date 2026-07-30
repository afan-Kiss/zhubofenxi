import React, { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../ui/Pagination'
import { BoardDrawerShell } from './BoardDrawerShell'
import { QianfanOrderDetailButton } from './QianfanOrderDetailButton'
import { OrderAnchorAssignControl } from './OrderAnchorAssignControl'
import {
  SignedOrdersFilterBar,
  type SignedFilterAnchor,
  type SignedFilterShop,
} from './SignedOrdersFilterBar'
import {
  attributionSourceShortLabel,
  boardRowDisplayOrderNo,
  displayAfterSaleReason,
  displayCell,
  type BoardDrillOrderRow,
} from '../../lib/board-order-row'
import { orderStatusLabelForRow } from '../../lib/derive-after-sale-display'
import { useManualOrderAnchorAssign } from '../../hooks/useManualOrderAnchorAssign'

type SignedSummary = {
  orderCount: number
  signedAmount: number
  shopCount: number
  anchorCount: number
  missingSignTimeCount: number
}

type GroupSummary = {
  shops: Array<{
    liveAccountId: string
    liveAccountName: string
    orderCount: number
    signedAmount: number
    anchorCount: number
    anchors: Array<{
      anchorId: string
      anchorName: string
      orderCount: number
      signedAmount: number
      latestSignTime: string | null
    }>
  }>
}

type SignedDetailData = {
  title: string
  formulaText?: string
  dateRange?: { preset?: string; startDate: string; endDate: string }
  summary: {
    matchedOrders?: number
    valueRaw?: number
    description?: string
  }
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  rows: BoardDrillOrderRow[]
  sort?: string
  filters?: { shopId: string | null; anchorId: string | null; keyword: string }
  filterOptions?: { shops: SignedFilterShop[]; anchors: SignedFilterAnchor[] }
  filteredSummary?: SignedSummary
  allSummary?: SignedSummary
  groupSummary?: GroupSummary
  blacklistedBuyerIds?: string[]
  allowManualAnchorAssign?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  startDate: string
  endDate: string
  preset?: string
  anchorId?: string
  anchorName?: string
  overviewStableSnapshot?: boolean
  onOrderAnchorAssigned?: () => void
  /** 嵌入签收单数 tab 时不渲染独立壳 */
  embedded?: boolean
  metric?: 'actualSignedAmount' | 'signedCount' | 'signRate'
  tab?: string
}

function formatSignTimeShort(signTime: string | null | undefined): string {
  if (!signTime) return '尚未交易完成'
  // YYYY-MM-DD HH:mm:ss → MM-DD HH:mm
  const m = signTime.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (m) return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`
  return signTime
}

function statusLabel(row: BoardDrillOrderRow): string {
  // 只展示官网原文：订单状态 + 售后状态（若有），禁止内部改写
  const official =
    displayCell(row.orderStatus) !== '—'
      ? String(row.orderStatus).trim()
      : (row.cardStatusLabel?.trim() ||
        orderStatusLabelForRow(row as never) ||
        '—')
  const afterSaleOfficial = String(
    (row as { afterSaleStatusText?: string }).afterSaleStatusText ?? '',
  ).trim()
  // afterSaleStatus 可能是内部改写，仅当 afterSaleStatusText 缺失时回退，且排除内部口径词
  const afterSaleFallback = String(row.afterSaleStatus ?? '').trim()
  const afterSale =
    afterSaleOfficial && afterSaleOfficial !== '—'
      ? afterSaleOfficial
      : afterSaleFallback &&
          afterSaleFallback !== '—' &&
          !['售后已取消', '售后关闭'].includes(afterSaleFallback)
        ? afterSaleFallback
        : ''
  if (afterSale && !official.includes(afterSale)) {
    return `${official} · ${afterSale}`
  }
  return official || '—'
}

function shopKey(row: BoardDrillOrderRow): string {
  return (row.liveAccountId || 'unknown').trim() || 'unknown'
}

function normalizeAnchorKey(name: string): string {
  return name
    .trim()
    .normalize('NFKC')
    .replace(/\u3000/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function anchorKey(row: BoardDrillOrderRow): string {
  const name = (row.anchorName || '未归属').trim() || '未归属'
  const unassigned = !name || name === '未归属' || name === '—'
  const id = unassigned ? '__unassigned__' : normalizeAnchorKey(name)
  return `${shopKey(row)}::${id}`
}

export const SignedOrdersDrillView: React.FC<Props> = ({
  open,
  onClose,
  startDate,
  endDate,
  preset,
  anchorId: scopeAnchorId,
  anchorName: scopeAnchorName,
  overviewStableSnapshot = false,
  onOrderAnchorAssigned,
  embedded = false,
  metric = 'actualSignedAmount',
  tab = 'signed',
}) => {
  const { formatMoney, formatCount } = useAmountDisplay()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SignedDetailData | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [shopId, setShopId] = useState('')
  const [listAnchorId, setListAnchorId] = useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const requestSeqRef = useRef(0)
  const tableTopRef = useRef<HTMLDivElement>(null)
  const rangeKeyRef = useRef(`${startDate}|${endDate}|${metric}|${preset ?? ''}`)

  const bumpReload = () => setReloadNonce((n) => n + 1)

  const {
    anchorOptions,
    optionsError,
    reloadOptions,
    assigningOrderNo,
    assignError,
    assignSuccess,
    handleManualAssign,
    handleClearManualOverride,
    clearAssignError,
    clearAssignSuccess,
  } = useManualOrderAnchorAssign({
    enabled: open,
    onAssigned: () => {
      bumpReload()
      onOrderAnchorAssigned?.()
    },
  })

  // 日期/指标变化清空筛选，避免短暂展示旧范围数据
  useEffect(() => {
    if (!open) return
    const nextKey = `${startDate}|${endDate}|${metric}|${preset ?? ''}`
    if (rangeKeyRef.current !== nextKey) {
      rangeKeyRef.current = nextKey
      setShopId('')
      setListAnchorId('')
      setKeywordInput('')
      setKeyword('')
      setPage(1)
      setData(null)
      setError(null)
      clearAssignError()
      clearAssignSuccess()
    }
  }, [
    open,
    startDate,
    endDate,
    metric,
    preset,
    clearAssignError,
    clearAssignSuccess,
  ])

  // 关键词防抖
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = keywordInput.trim()
      setKeyword((prev) => {
        if (prev === next) return prev
        setPage(1)
        return next
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [keywordInput])

  useEffect(() => {
    if (!open || !startDate || !endDate) return
    const controller = new AbortController()
    const seq = ++requestSeqRef.current
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
          sort: 'shop_anchor_sign_desc',
        })
        if (preset) qs.set('preset', preset)
        if (tab) qs.set('tab', tab)
        if (scopeAnchorId) qs.set('anchorId', scopeAnchorId)
        if (scopeAnchorName) qs.set('anchorName', scopeAnchorName)
        if (shopId) qs.set('shopId', shopId)
        if (listAnchorId) qs.set('listAnchorId', listAnchorId)
        if (keyword) qs.set('keyword', keyword)
        if (overviewStableSnapshot) qs.set('overviewStableSnapshot', 'true')

        const res = await apiRequest<SignedDetailData>(`/api/board/metric-detail?${qs}`, {
          signal: controller.signal,
        })
        if (controller.signal.aborted || seq !== requestSeqRef.current) return
        setData(res)
      } catch (e) {
        if (controller.signal.aborted || seq !== requestSeqRef.current) return
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!controller.signal.aborted && seq === requestSeqRef.current) {
          setLoading(false)
        }
      }
    })()

    return () => controller.abort()
  }, [
    open,
    metric,
    startDate,
    endDate,
    page,
    pageSize,
    tab,
    preset,
    scopeAnchorId,
    scopeAnchorName,
    shopId,
    listAnchorId,
    keyword,
    reloadNonce,
    overviewStableSnapshot,
  ])

  const hasActiveFilters = Boolean(shopId || listAnchorId || keyword || keywordInput.trim())
  const filtered = data?.filteredSummary
  const all = data?.allSummary
  const showFilterCompare =
    hasActiveFilters &&
    filtered != null &&
    all != null &&
    (filtered.orderCount !== all.orderCount ||
      Math.abs(filtered.signedAmount - all.signedAmount) > 0.009)

  const groupIndex = useMemo(() => {
    const shops = new Map<string, GroupSummary['shops'][number]>()
    const anchors = new Map<string, GroupSummary['shops'][number]['anchors'][number] & { shopId: string }>()
    for (const shop of data?.groupSummary?.shops ?? []) {
      shops.set(shop.liveAccountId, shop)
      for (const a of shop.anchors) {
        const name = (a.anchorName || '未归属').trim() || '未归属'
        const unassigned = !name || name === '未归属' || name === '—'
        const id = unassigned ? '__unassigned__' : normalizeAnchorKey(name)
        anchors.set(`${shop.liveAccountId}::${id}`, {
          ...a,
          shopId: shop.liveAccountId,
        })
      }
    }
    return { shops, anchors }
  }, [data?.groupSummary])

  const title =
    preset === 'thisMonth' || (!preset && startDate?.slice(8) === '01')
      ? '本月已签收明细'
      : '已签收明细'

  const rangeText =
    data?.dateRange?.startDate && data?.dateRange?.endDate
      ? `${data.dateRange.startDate} 至 ${data.dateRange.endDate}`
      : `${startDate} 至 ${endDate}`

  const subtitle = `统计范围：${rangeText}　排序：店铺 → 主播 → 订单完成时间（新到旧）`

  const allowManualAssign = data?.allowManualAnchorAssign !== false

  const body = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          {
            label: '已签收金额',
            value: formatMoney(filtered?.signedAmount ?? all?.signedAmount ?? data?.summary.valueRaw ?? 0),
          },
          {
            label: '已签收单数',
            value: formatCount(filtered?.orderCount ?? all?.orderCount ?? data?.summary.matchedOrders ?? 0),
          },
          {
            label: '涉及店铺',
            value: formatCount(filtered?.shopCount ?? all?.shopCount ?? 0),
          },
          {
            label: '涉及主播',
            value: formatCount(filtered?.anchorCount ?? all?.anchorCount ?? 0),
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[#E3E7E2] bg-[#FBFCFA] px-3 py-2.5"
          >
            <p className="text-[11px] text-[#667069]">{card.label}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-[#202722]">{card.value}</p>
          </div>
        ))}
      </div>

      {showFilterCompare ? (
        <p className="text-[11px] text-[#667069]">
          全部：{formatMoney(all!.signedAmount)} / {formatCount(all!.orderCount)} 单
          {' · '}
          当前筛选：{formatMoney(filtered!.signedAmount)} / {formatCount(filtered!.orderCount)} 单
        </p>
      ) : null}

      {(filtered?.missingSignTimeCount ?? 0) > 0 ? (
        <div className="rounded-lg border border-[#E3E7E2] bg-[#FFF8E8] px-3 py-2 text-[11px] text-[#667069]">
          有 {filtered!.missingSignTimeCount} 笔订单缺少订单完成时间，已排在对应主播最后
        </div>
      ) : null}

      <SignedOrdersFilterBar
        shops={data?.filterOptions?.shops ?? []}
        anchors={data?.filterOptions?.anchors ?? []}
        shopId={shopId}
        anchorId={listAnchorId}
        keyword={keywordInput}
        disabled={loading && !data}
        hasActiveFilters={hasActiveFilters}
        onShopChange={(id) => {
          setShopId(id)
          setListAnchorId('')
          setPage(1)
        }}
        onAnchorChange={(id) => {
          setListAnchorId(id)
          setPage(1)
        }}
        onKeywordChange={setKeywordInput}
        onReset={() => {
          setShopId('')
          setListAnchorId('')
          setKeywordInput('')
          setKeyword('')
          setPage(1)
        }}
      />

      <div ref={tableTopRef} className="scroll-mt-2">
        {error ? (
          <div className="rounded-xl border border-dashed border-red-200 bg-red-50/60 py-10 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="mt-3 rounded-full border border-red-200 bg-white px-4 py-1.5 text-xs text-red-700"
            >
              重试
            </button>
          </div>
        ) : loading && !data ? (
          <SignedTableSkeleton />
        ) : !data || data.rows.length === 0 ? (
          <div className="rounded-xl border border-[#E3E7E2] bg-[#FBFCFA] py-12 text-center text-sm text-[#667069]">
            当前筛选条件下暂无已签收订单
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <SignedDesktopTable
                rows={data.rows}
                groupIndex={groupIndex}
                formatMoney={formatMoney}
                expandedKey={expandedKey}
                onToggle={(key) => setExpandedKey((cur) => (cur === key ? null : key))}
                loading={loading}
                allowManualAssign={allowManualAssign}
                anchorOptions={anchorOptions}
                assigningOrderNo={assigningOrderNo}
                onAssign={(orderNo, name, current) => {
                  void handleManualAssign(orderNo, name, current).then(() => {
                    // 成功提示在 hook 内；补充移动分组文案
                  })
                }}
                onClearManualOverride={(orderNo) => {
                  void handleClearManualOverride(orderNo)
                }}
                onAssignMovedHint={() => {
                  /* handled via assignSuccess override below */
                }}
              />
            </div>
            <div className="md:hidden">
              <SignedMobileCards
                rows={data.rows}
                formatMoney={formatMoney}
                expandedKey={expandedKey}
                onToggle={(key) => setExpandedKey((cur) => (cur === key ? null : key))}
                allowManualAssign={allowManualAssign}
                anchorOptions={anchorOptions}
                assigningOrderNo={assigningOrderNo}
                onAssign={(orderNo, name, current) => {
                  void handleManualAssign(orderNo, name, current)
                }}
                onClearManualOverride={(orderNo) => {
                  void handleClearManualOverride(orderNo)
                }}
              />
            </div>
          </>
        )}
      </div>

      {allowManualAssign && optionsError ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-red-600">
          <span>主播选项加载失败：{optionsError}</span>
          <button
            type="button"
            onClick={() => reloadOptions()}
            className="rounded border border-red-200 bg-white px-2 py-0.5 text-red-700 hover:bg-red-50"
          >
            重新加载
          </button>
        </div>
      ) : null}
      {allowManualAssign && assignError ? <p className="text-xs text-red-600">{assignError}</p> : null}
      {allowManualAssign && assignSuccess ? (
        <p className="text-xs text-[#477A5D]">
          {assignSuccess.includes('已')
            ? '主播已修改，订单已移动到新的主播分组。'
            : assignSuccess}
        </p>
      ) : null}

      {data ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-[11px] text-[#667069]">
            每页
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="h-8 rounded-lg border border-[#E3E7E2] bg-white px-2 text-xs"
            >
              {[20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            条
          </label>
          <Pagination
            page={data.pagination.page}
            total={data.pagination.total}
            pageSize={data.pagination.pageSize}
            onPage={setPage}
          />
        </div>
      ) : null}
    </div>
  )

  if (embedded) return body

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      tone="signed"
      scrollResetKey={`${page}-${pageSize}-${shopId}-${listAnchorId}-${keyword}`}
      scrollTargetRef={tableTopRef}
    >
      {body}
    </BoardDrawerShell>
  )
}

function SignedTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-[#E3E7E2] bg-[#FBFCFA]">
      <div className="h-10 border-b border-[#E3E7E2] bg-[#EDF5F0]" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-12 border-b border-[#E3E7E2]/60 bg-gradient-to-r from-[#F2F5F2] via-[#FBFCFA] to-[#F2F5F2]"
        />
      ))}
    </div>
  )
}

function SignedDesktopTable(props: {
  rows: BoardDrillOrderRow[]
  groupIndex: {
    shops: Map<string, GroupSummary['shops'][number]>
    anchors: Map<string, GroupSummary['shops'][number]['anchors'][number] & { shopId: string }>
  }
  formatMoney: (n: number) => string
  expandedKey: string | null
  onToggle: (key: string) => void
  loading: boolean
  allowManualAssign: boolean
  anchorOptions: Array<{ id: string; name: string }>
  assigningOrderNo: string | null
  onAssign: (orderNo: string, anchorName: string, current?: string) => void
  onClearManualOverride: (orderNo: string) => void
  onAssignMovedHint: () => void
}) {
  const {
    rows,
    groupIndex,
    formatMoney,
    expandedKey,
    onToggle,
    loading,
    allowManualAssign,
    anchorOptions,
    assigningOrderNo,
    onAssign,
    onClearManualOverride,
  } = props

  let lastShop = ''
  let lastAnchor = ''

  return (
    <div
      className={`overflow-auto rounded-xl border border-[#E3E7E2] bg-[#FBFCFA] ${loading ? 'opacity-70' : ''}`}
    >
      <table className="min-w-full border-collapse text-left text-xs text-[#202722]">
        <thead className="sticky top-0 z-20 bg-[#EDF5F0] text-[11px] text-[#667069]">
          <tr>
            <th className="whitespace-nowrap px-2 py-2.5 font-medium">订单完成时间</th>
            <th className="whitespace-nowrap px-2 py-2.5 font-medium">订单号</th>
            <th className="whitespace-nowrap px-2 py-2.5 font-medium">买家</th>
            <th className="whitespace-nowrap px-2 py-2.5 font-medium">商品</th>
            <th className="whitespace-nowrap px-2 py-2.5 text-right font-medium">已签收金额</th>
            <th className="whitespace-nowrap px-2 py-2.5 text-right font-medium">支付金额</th>
            <th className="whitespace-nowrap px-2 py-2.5 text-right font-medium">退款金额</th>
            <th className="whitespace-nowrap px-2 py-2.5 font-medium">状态</th>
            <th className="whitespace-nowrap px-2 py-2.5 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const sk = shopKey(row)
            const ak = anchorKey(row)
            const showShop = sk !== lastShop
            const showAnchor = showShop || ak !== lastAnchor
            lastShop = sk
            lastAnchor = ak
            const rowKey = `${boardRowDisplayOrderNo(row)}-${idx}`
            const shopMeta = groupIndex.shops.get(sk)
            const anchorMeta = groupIndex.anchors.get(ak)
            const expanded = expandedKey === rowKey

            return (
              <React.Fragment key={rowKey}>
                {showShop ? (
                  <tr className="bg-[#E8EEE9]">
                    <td colSpan={9} className="px-3 py-2 text-[13px]">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="shrink-0 text-[11px] font-medium text-[#667069]">
                          直播号
                        </span>
                        <span className="font-semibold text-[#202722]">
                          {row.liveAccountName || shopMeta?.liveAccountName || '未知直播号'}
                        </span>
                        <span className="tabular-nums text-[#667069]">
                          {shopMeta?.orderCount ?? '—'} 单 · 已签收{' '}
                          {formatMoney(shopMeta?.signedAmount ?? 0)} ·{' '}
                          {shopMeta?.anchorCount ?? '—'} 位主播
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {showAnchor ? (
                  <tr className="bg-[#F2F5F2]">
                    <td colSpan={9} className="px-3 py-1.5 text-[12px]">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="shrink-0 text-[11px] font-medium text-[#667069]">
                          主播
                        </span>
                        <span className="font-medium text-[#202722]">
                          {row.anchorName || '未归属'}
                        </span>
                        <span className="tabular-nums text-[#667069]">
                          {anchorMeta?.orderCount ?? '—'} 单 · 已签收{' '}
                          {formatMoney(anchorMeta?.signedAmount ?? 0)} · 最近订单完成{' '}
                          {formatSignTimeShort(anchorMeta?.latestSignTime)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : null}
                <tr
                  className="cursor-pointer border-t border-[#E3E7E2]/80 hover:bg-[#F2F5F2]"
                  style={{ height: 52 }}
                  onClick={() => onToggle(rowKey)}
                >
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-[#667069]">
                    {row.signTime ||
                      (String(row.orderStatus || row.cardStatusLabel || '').includes('已签收')
                        ? '尚未交易完成'
                        : '完成时间待同步')}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-mono text-[11px]">{boardRowDisplayOrderNo(row)}</div>
                  </td>
                  <td className="max-w-[100px] truncate px-2 py-1.5" title={row.buyerNickname}>
                    {displayCell(row.buyerNickname)}
                  </td>
                  <td
                    className="max-w-[240px] truncate px-2 py-1.5"
                    title={row.productName || ''}
                  >
                    {displayCell(row.productName)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-[#477A5D]">
                    {formatMoney(Number(row.signedAmount ?? 0))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[#667069]">
                    {formatMoney(
                      Number(
                        row.paymentBaseAmount ??
                          row.officialPaidAmount ??
                          row.payAmount ??
                          0,
                      ),
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[#667069]">
                    {formatMoney(Number(row.refundAmount ?? row.productRefundAmount ?? 0))}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className="rounded-md bg-[#EDF5F0] px-1.5 py-0.5 text-[10px] text-[#477A5D]">
                      {statusLabel(row)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded border border-[#E3E7E2] bg-white px-1.5 py-0.5 text-[10px] text-[#667069] hover:bg-[#F2F5F2]"
                        onClick={() => onToggle(rowKey)}
                      >
                        {expanded ? '收起' : '详情'}
                      </button>
                      <QianfanOrderDetailButton
                        orderNo={boardRowDisplayOrderNo(row)}
                        compact
                        label="千帆"
                      />
                    </div>
                  </td>
                </tr>
                {expanded ? (
                  <tr className="bg-[#FBFCFA]">
                    <td colSpan={9} className="px-3 py-3">
                      <SignedExpandDetail
                        row={row}
                        allowManualAssign={allowManualAssign}
                        anchorOptions={anchorOptions}
                        assigningOrderNo={assigningOrderNo}
                        onAssign={onAssign}
                        onClearManualOverride={onClearManualOverride}
                      />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SignedMobileCards(props: {
  rows: BoardDrillOrderRow[]
  formatMoney: (n: number) => string
  expandedKey: string | null
  onToggle: (key: string) => void
  allowManualAssign: boolean
  anchorOptions: Array<{ id: string; name: string }>
  assigningOrderNo: string | null
  onAssign: (orderNo: string, anchorName: string, current?: string) => void
  onClearManualOverride: (orderNo: string) => void
}) {
  const {
    rows,
    formatMoney,
    expandedKey,
    onToggle,
    allowManualAssign,
    anchorOptions,
    assigningOrderNo,
    onAssign,
    onClearManualOverride,
  } = props

  return (
    <div className="space-y-2">
      {rows.map((row, idx) => {
        const rowKey = `${boardRowDisplayOrderNo(row)}-${idx}`
        const expanded = expandedKey === rowKey
        return (
          <div
            key={rowKey}
            role="button"
            tabIndex={0}
            onClick={() => onToggle(rowKey)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle(rowKey)
              }
            }}
            className="w-full cursor-pointer rounded-xl border border-[#E3E7E2] bg-[#FBFCFA] p-3 text-left"
          >
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded bg-[#E8EEE9] px-1.5 py-0.5 text-[10px] text-[#202722]">
                {row.liveAccountName || '未知直播号'}
              </span>
              <span className="rounded bg-[#EDF5F0] px-1.5 py-0.5 text-[10px] text-[#477A5D]">
                {row.anchorName || '未归属'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-[#667069]">
                {formatSignTimeShort(row.signTime)} · {statusLabel(row)}
              </span>
              <span className="text-sm font-semibold tabular-nums text-[#477A5D]">
                {formatMoney(Number(row.signedAmount ?? 0))}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-[#202722]">
              订单 {boardRowDisplayOrderNo(row)}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[#667069]">
              买家：{displayCell(row.buyerNickname)}
            </p>
            <p className="truncate text-[11px] text-[#667069]">
              商品：{displayCell(row.productName)}
            </p>
            {expanded ? (
              <div className="mt-2 border-t border-[#E3E7E2] pt-2" onClick={(e) => e.stopPropagation()}>
                <SignedExpandDetail
                  row={row}
                  allowManualAssign={allowManualAssign}
                  anchorOptions={anchorOptions}
                  assigningOrderNo={assigningOrderNo}
                  onAssign={onAssign}
                  onClearManualOverride={onClearManualOverride}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function SignedExpandDetail(props: {
  row: BoardDrillOrderRow
  allowManualAssign: boolean
  anchorOptions: Array<{ id: string; name: string }>
  assigningOrderNo: string | null
  onAssign: (orderNo: string, anchorName: string, current?: string) => void
  onClearManualOverride: (orderNo: string) => void
}) {
  const { row, allowManualAssign, anchorOptions, assigningOrderNo, onAssign, onClearManualOverride } =
    props
  const hasAfterSale =
    Boolean(row.hasEffectiveAfterSale) ||
    (row.afterSaleStatus && row.afterSaleStatus !== '—' && row.afterSaleStatus !== '无售后') ||
    Number(row.refundAmount ?? row.productRefundAmount ?? 0) > 0 ||
    Boolean(row.isQualityReturn)

  return (
    <div className="grid gap-3 text-[11px] text-[#667069] sm:grid-cols-3">
      <div className="space-y-1">
        <p className="font-medium text-[#202722]">时间信息</p>
        <p>下单时间：{displayCell(row.orderTime)}</p>
        <p>支付时间：{displayCell(row.payTime)}</p>
        <p>
          订单完成时间：
          {row.signTime ||
            (String(row.orderStatus || row.cardStatusLabel || '').includes('已签收')
              ? '尚未交易完成'
              : '完成时间待同步')}
        </p>
      </div>
      <div className="space-y-1">
        <p className="font-medium text-[#202722]">归属信息</p>
        <p>来源店铺：{displayCell(row.liveAccountName)}</p>
        <p>归属主播：{displayCell(row.anchorName)}</p>
        <p>归属来源：{attributionSourceShortLabel(row.attributionSource)}</p>
        <p>归属说明：{displayCell(row.attributionExplain)}</p>
        <p>是否人工指定：{row.manualOverride ? '是' : '否'}</p>
        {allowManualAssign ? (
          <div className="pt-1">
            <OrderAnchorAssignControl
              orderNo={boardRowDisplayOrderNo(row)}
              defaultAnchorName={row.anchorName}
              attributionSource={row.attributionSource}
              anchorOptions={anchorOptions}
              assigningOrderNo={assigningOrderNo}
              onAssign={(orderNo, name) => onAssign(orderNo, name, row.anchorName)}
              onClearManualOverride={onClearManualOverride}
            />
          </div>
        ) : null}
      </div>
      <div className="space-y-1">
        <p className="font-medium text-[#202722]">售后信息</p>
        {hasAfterSale ? (
          <>
            <p>订单状态：{statusLabel(row)}</p>
            <p>售后状态：{displayCell(row.afterSaleStatusLabel ?? row.afterSaleStatus)}</p>
            <p>售后原因：{displayAfterSaleReason(row)}</p>
            <p>
              退款金额：
              {Number(row.refundAmount ?? row.productRefundAmount ?? 0).toFixed(2)}
            </p>
            <p>品退标记：{row.isQualityReturn ? '是' : '否'}</p>
            <p>品退来源：{displayCell(row.qualitySourceLabel)}</p>
            <p>售后印证：{displayCell(row.qualityVerifyDisplayLabel)}</p>
          </>
        ) : (
          <p>无售后</p>
        )}
      </div>
    </div>
  )
}
