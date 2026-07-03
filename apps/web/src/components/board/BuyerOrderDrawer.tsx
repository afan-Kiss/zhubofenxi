import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../ui/Pagination'
import { buyerDisplayNameFromRow } from '../../lib/buyer-profile'
import type { BuyerOrderDateScope } from '../../lib/anchor-weekly-ranking'
import { resolveDisplayEarnedAmountCent } from '../../lib/buyer-earned-amount'
import { BoardDrawerShell } from './BoardDrawerShell'
import { BoardDrillOrderTable, type BoardDrillOrderRow } from './BoardDrillOrderTable'
import { MetricInfoTooltip } from './MetricInfoTooltip'
import { getMetricExplain } from '../../lib/metricExplain'

interface BuyerOrderTab {
  key: string
  label: string
  count: number
  emptyText?: string
}

interface BuyerOrderSummaryCent {
  receivableAmountCent: number
  payAmountCent: number
  refundAmountCent: number
  netDealAmountCent?: number
  realDealAmountCent?: number
  displayEarnedAmountCent?: number
  orderCount: number
  paidOrderCount: number
  realDealOrderCount?: number
  refundOrderCount: number
  qualityRefundOrderCount: number
  pendingAfterSaleOrderCount?: number
}

interface BuyerDrillData {
  buyerKey?: string
  buyerId: string
  nickname: string
  buyerDisplayName?: string
  buyerDisplayLabel?: string
  buyerShortCode?: string
  identitySource?: string
  buyerIdentityCode?: string
  stats: BuyerOrderDrawerBuyer | null
  buyerSummary?: BuyerOrderSummaryCent
  tabs?: BuyerOrderTab[]
  currentFilterSummary?: BuyerOrderSummaryCent & { tab?: string }
  emptyText?: string
  source: string
  profileUpdatedAt: string | null
  blacklistedBuyerIds?: string[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  rows: BoardDrillOrderRow[]
}

export interface BuyerOrderDrawerBuyer {
  buyerKey: string
  buyerId: string
  officialBuyerId?: string
  nickname: string
  buyerDisplayName?: string
  buyerDisplayLabel?: string
  buyerShortCode?: string
  buyerIdentityCode?: string
  identitySource?: string
  gmv: number
  statPaidAmount?: number
  receivableAmount?: number
  orderCount: number
  paidOrderCount?: number
  productRefundAmount: number
  refundCount?: number
  refundTimes: number
  afterSaleCount?: number
  qualityReturnCount: number
  signedOrderCount?: number
  returnRefundCount?: number
  freightRefundCount?: number
  signedAmount?: number
  isBlacklisted?: boolean
  /** 排行列表侧 buyerSummary，用于开发环境一致性校验 */
  listBuyerSummary?: BuyerOrderSummaryCent
}

interface Props {
  open: boolean
  onClose: () => void
  buyer: BuyerOrderDrawerBuyer | null
  scope?: BuyerOrderDateScope
}

function centToYuan(cent: number): number {
  return cent / 100
}

function summaryFromCent(s: BuyerOrderSummaryCent | undefined, fallback: BuyerOrderDrawerBuyer) {
  if (!s) {
    const list = fallback.listBuyerSummary
    const earnedCent = list
      ? resolveDisplayEarnedAmountCent({
          displayEarnedAmountCent: list.displayEarnedAmountCent,
          netDealAmountCent: list.netDealAmountCent,
          realDealAmountCent: list.realDealAmountCent,
        })
      : 0
    return {
      earnedAmount: centToYuan(earnedCent),
      orderCount: fallback.orderCount,
      realDealOrderCount: 0,
      refundOrderCount: fallback.refundCount ?? fallback.refundTimes ?? 0,
      qualityRefundOrderCount: fallback.qualityReturnCount,
      pendingAfterSaleOrderCount: fallback.afterSaleCount ?? 0,
    }
  }
  const earnedCent = resolveDisplayEarnedAmountCent({
    displayEarnedAmountCent: s.displayEarnedAmountCent,
    netDealAmountCent: s.netDealAmountCent,
    realDealAmountCent: s.realDealAmountCent,
  })
  return {
    earnedAmount: centToYuan(earnedCent),
    orderCount: s.orderCount,
    realDealOrderCount: s.realDealOrderCount ?? 0,
    refundOrderCount: s.refundOrderCount,
    qualityRefundOrderCount: s.qualityRefundOrderCount,
    pendingAfterSaleOrderCount: s.pendingAfterSaleOrderCount ?? 0,
  }
}

export const BuyerOrderDrawer: React.FC<Props> = ({ open, onClose, buyer, scope }) => {
  const { formatMoney } = useAmountDisplay()
  const [tab, setTab] = useState('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BuyerDrillData | null>(null)
  /** 顶部历史累计：仅打开 Drawer 时更新，不随 Tab 切换变化 */
  const [buyerSummary, setBuyerSummary] = useState<BuyerOrderSummaryCent | null>(null)
  const pageSize = 20

  const load = useCallback(async () => {
    if (!open || !buyer?.buyerKey) return
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        tab,
      })
      if (scope?.source === 'anchor_weekly_ranking' || scope?.source === 'bad_buyer_ranking') {
        qs.set('source', scope.source)
        qs.set('startDate', scope.startDate)
        qs.set('endDate', scope.endDate)
        if (scope.source === 'anchor_weekly_ranking' && scope.anchorName) {
          qs.set('anchorName', scope.anchorName)
        }
      }
      const res = await apiRequest<{
        buyerKey: string
        buyerId: string
        nickname: string
        buyerDisplayName?: string
        buyerDisplayLabel?: string
        buyerShortCode?: string
        buyerIdentityCode?: string
        identitySource?: string
        summary?: BuyerOrderSummaryCent
        tabs?: BuyerOrderTab[]
        currentFilterSummary?: BuyerOrderSummaryCent & { tab?: string }
        emptyText?: string
        source: string
        profileUpdatedAt: string | null
        blacklistedBuyerIds?: string[]
        pagination: BuyerDrillData['pagination']
        rows: BoardDrillOrderRow[]
      }>(`/api/board/buyer-profile/${encodeURIComponent(buyer.buyerKey)}/orders?${qs}`)
      setData({
        buyerKey: res.buyerKey,
        buyerId: res.buyerId,
        nickname: res.nickname,
        buyerDisplayName: res.buyerDisplayName,
        buyerDisplayLabel: res.buyerDisplayLabel,
        buyerShortCode: res.buyerShortCode,
        buyerIdentityCode: res.buyerIdentityCode,
        identitySource: res.identitySource,
        stats: null,
        buyerSummary: res.summary,
        tabs: res.tabs,
        currentFilterSummary: res.currentFilterSummary,
        emptyText: res.emptyText,
        source: res.source,
        profileUpdatedAt: res.profileUpdatedAt,
        blacklistedBuyerIds: res.blacklistedBuyerIds,
        pagination: res.pagination,
        rows: res.rows,
      })
      if (res.summary) {
        setBuyerSummary(res.summary)
      }
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [open, buyer?.buyerKey, page, tab, scope])

  useEffect(() => {
    if (open && buyer) {
      setPage(1)
      setTab('all')
      setData(null)
      setBuyerSummary(null)
      setError(null)
    }
  }, [
    open,
    buyer?.buyerKey,
    scope?.startDate,
    scope?.endDate,
    scope?.source,
    scope?.source === 'anchor_weekly_ranking' ? scope.anchorName : undefined,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!import.meta.env.DEV || !buyer?.listBuyerSummary || !data?.buyerSummary) return
    const list = buyer.listBuyerSummary
    const drawer = data.buyerSummary
    const listEarned = resolveDisplayEarnedAmountCent({
      displayEarnedAmountCent: list.displayEarnedAmountCent,
      netDealAmountCent: list.netDealAmountCent,
      realDealAmountCent: list.realDealAmountCent,
    })
    const drawerEarned = resolveDisplayEarnedAmountCent({
      displayEarnedAmountCent: drawer.displayEarnedAmountCent,
      netDealAmountCent: drawer.netDealAmountCent,
      realDealAmountCent: drawer.realDealAmountCent,
    })
    const mismatch =
      list.refundOrderCount !== drawer.refundOrderCount ||
      list.qualityRefundOrderCount !== drawer.qualityRefundOrderCount ||
      listEarned !== drawerEarned
    if (mismatch) {
      console.warn('[BuyerProfileMismatch] 买家排行列表与 Drawer 统计不一致', {
        buyerId: buyer.buyerKey,
        listSummary: list,
        drawerSummary: drawer,
        listEarned,
        drawerEarned,
      })
    }
  }, [buyer, data?.buyerSummary])

  if (!buyer) return null

  const headerSummary = summaryFromCent(buyerSummary ?? data?.buyerSummary, buyer)
  const filterSummary = data?.currentFilterSummary
  const tabs = data?.tabs ?? [
    { key: 'all', label: '全部订单', count: headerSummary.orderCount },
    { key: 'normal_signed', label: '正常签收', count: 0 },
    { key: 'after_sale', label: '售后 / 退款', count: 0 },
    { key: 'refund_only', label: '仅退款', count: 0 },
    { key: 'return_refund', label: '退货退款', count: 0 },
    { key: 'shipping_compensation', label: '运费补偿', count: 0 },
    { key: 'quality_refund', label: '品退', count: 0 },
  ]

  const displayName =
    data?.buyerDisplayName ??
    buyer.buyerDisplayName ??
    data?.nickname ??
    buyer.nickname ??
    buyerDisplayNameFromRow(buyer as unknown as Record<string, unknown>)

  const isRangeScope =
    scope?.source === 'anchor_weekly_ranking' || scope?.source === 'bad_buyer_ranking'
  const periodLabel = isRangeScope
    ? `${scope.startDate} 至 ${scope.endDate} 订单明细`
    : '历史累计订单明细（全量，不按日期筛选）'

  const emptyText =
    tabs.find((t) => t.key === tab)?.emptyText ??
    data?.emptyText ??
    (isRangeScope ? '该买家在本周期内暂无订单' : '该买家暂无历史订单')

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      testId="buyer-order-drawer"
      title={displayName}
      headerExtra={
        <div
          key={data?.buyerKey ?? buyer.buyerKey}
          className="mt-2 animate-in fade-in duration-300"
        >
          <p className="text-[10px] text-slate-500">{periodLabel}</p>
          {!isRangeScope ? (
            <p className="mt-1 text-[10px] text-slate-400">
              售后数据来自最近一次自动同步；如有延迟，将在后续自动同步中更新
            </p>
          ) : null}
          <div className="mt-3 rounded-2xl border border-rose-100/80 bg-gradient-to-br from-white to-rose-50/40 px-4 py-3">
            <div className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              {isRangeScope ? '周期成交金额' : '赚到金额'}
              <MetricInfoTooltip text={getMetricExplain('earnedAmount')} />
            </div>
            <p className="mt-1 text-3xl font-bold tabular-nums text-rose-900">
              {formatMoney(headerSummary.earnedAmount)}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              {isRangeScope
                ? '仅统计当前周期范围内的订单，不是历史全量客户画像。'
                : '这个客户最终留下的真实成交金额，不是利润，不扣成本'}
            </p>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 md:gap-x-3">
            {[
              { label: '成交订单数', value: String(headerSummary.realDealOrderCount) },
              { label: '退款订单数', value: String(headerSummary.refundOrderCount) },
              { label: '品退订单数', value: String(headerSummary.qualityRefundOrderCount) },
              {
                label: '售后中订单数',
                value: String(headerSummary.pendingAfterSaleOrderCount),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-rose-100/80 bg-white/80 px-2.5 py-2"
              >
                <p className="text-[10px] text-slate-500">{item.label}</p>
                <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-slate-900">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
          {filterSummary && tab !== 'all' ? (
            <p className="mt-2 text-[10px] text-slate-500">
              当前筛选：{filterSummary.orderCount} 笔订单，品退{' '}
              {filterSummary.qualityRefundOrderCount} 笔
            </p>
          ) : null}
        </div>
      }
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
      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key)
              setPage(1)
            }}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all duration-200 ${
              tab === t.key ? 'bg-rose-500 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            {t.label}
            {t.count > 0 ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>
      {loading && !data ? (
        <BoardDrillOrderTable rows={[]} loading variant="buyer" />
      ) : error ? (
        <div className="animate-in fade-in rounded-2xl border border-dashed border-red-200 bg-red-50/50 py-12 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-full border border-red-200 bg-white px-4 py-1.5 text-xs text-red-700"
          >
            重试
          </button>
        </div>
      ) : (
        <div key={`${tab}-${data?.pagination.page ?? 0}`} className="animate-in fade-in duration-300">
          <BoardDrillOrderTable
            rows={data?.rows ?? []}
            listKey={`buyer-${buyer?.buyerKey ?? ''}-${tab}-${page}-${data?.rows.length ?? 0}`}
            blacklistedBuyerIds={data?.blacklistedBuyerIds}
            loading={loading && !!data}
            emptyText={emptyText}
            variant="buyer"
            headerRefundOrderCount={headerSummary.refundOrderCount}
          />
        </div>
      )}
    </BoardDrawerShell>
  )
}
