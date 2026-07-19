import React, { useEffect, useState } from 'react'
import { formatAnchorDisplayName } from '../../lib/anchor-display-name'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../ui/Pagination'
import { BoardDrawerShell } from './BoardDrawerShell'
import { QianfanOrderDetailButton } from './QianfanOrderDetailButton'

interface QualityRefundDrillRow {
  orderNo: string
  buyerNickname: string
  orderTime: string
  qualityAttributionAnchorName?: string
  orderAttributionSource?: string
  attributionExplain?: string
  liveAccountName?: string
  packageId?: string
  matchedLiveSessionStart?: string | null
  matchedLiveSessionEnd?: string | null
  qualityMainSource?: string
  qualitySourceLabel?: string
  officialQualityReasonText?: string
  qualityReasonText?: string
  afterSaleOrderNo?: string
  afterSaleStatus?: string
  afterSaleReasonText?: string
  afterSaleFinalReasonText?: string
  afterSaleRefundAmountYuan?: number
  afterSaleReasonChanged?: boolean
  extraHint?: string
  qualityUnassignedReason?: string | null
  paymentAnchorName?: string
  qianfanDetailAvailable?: boolean
}

interface DrillData {
  anchorName: string
  attributionNote?: string
  warning?: string
  qualityCountInconsistency?: {
    qualityReturnCount: number
    paginationTotal: number
  }
  stats: Record<string, unknown> | null
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  rows: QualityRefundDrillRow[]
}

interface Props {
  open: boolean
  onClose: () => void
  anchorName: string
  anchorId?: string
  preset?: string
  startDate: string
  endDate: string
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {
    window.prompt('复制以下内容', text)
  })
}

export const AnchorQualityRefundDrawer: React.FC<Props> = ({
  open,
  onClose,
  anchorName,
  anchorId,
  preset,
  startDate,
  endDate,
}) => {
  const { formatCount, formatMoney } = useAmountDisplay()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DrillData | null>(null)
  const pageSize = 18
  const [expandedOrderNos, setExpandedOrderNos] = useState<Set<string>>(() => new Set())

  const toggleExpand = (orderNo: string) => {
    setExpandedOrderNos((prev) => {
      const next = new Set(prev)
      if (next.has(orderNo)) next.delete(orderNo)
      else next.add(orderNo)
      return next
    })
  }

  useEffect(() => {
    if (!open) return
    setPage(1)
    setData(null)
    setError(null)
    setExpandedOrderNos(new Set())
  }, [open, anchorName, anchorId, startDate, endDate, preset])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({
      startDate,
      endDate,
      page: String(page),
      pageSize: String(pageSize),
    })
    if (preset) qs.set('preset', preset)
    if (anchorId) qs.set('anchorId', anchorId)
    if (anchorName) qs.set('anchorName', anchorName)

    void apiRequest<DrillData>(`/api/board/anchor-quality-refund-drill?${qs}`, {
      signal: controller.signal,
    })
      .then((res) => setData(res))
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : '加载品退明细失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [open, anchorName, anchorId, preset, startDate, endDate, page])

  const statsCount = Number(data?.stats?.qualityReturnCount ?? 0)
  const listTotal = Number(data?.pagination?.total ?? 0)
  const qualityCount = data?.warning ? listTotal : statsCount || listTotal

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title={`${formatAnchorDisplayName(anchorName)} · 品退明细`}
      subtitle={`${startDate} ~ ${endDate}`}
      scrollResetKey={page}
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
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[200px] animate-pulse rounded-xl bg-rose-50/80"
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
      ) : error ? (
        <p className="py-12 text-center text-sm text-red-600">{error}</p>
      ) : data ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-rose-50/60 p-4 text-xs text-slate-700">
            <p className="font-medium text-rose-900">
              品退订单数：{formatCount(qualityCount)}
            </p>
            {data.warning ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
                {data.warning}
              </p>
            ) : null}
            <p className="mt-2 leading-relaxed">
              {data.attributionNote ??
                '品退接口用于确认哪些订单发生品退。主播归属以订单下单时所在直播场次为准，支付、签收、退款和品退统一归到该订单主播。'}
            </p>
          </div>
          {data.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">暂无品退订单</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.rows.map((row) => {
                const officialReason =
                  row.officialQualityReasonText || row.qualityReasonText || '—'
                const afterSaleNo = row.afterSaleOrderNo?.trim() || ''
                const finalReason =
                  row.afterSaleFinalReasonText?.trim() || row.afterSaleReasonText?.trim() || ''
                const missingFinalReason = Boolean(afterSaleNo && !finalReason)
                const refundYuan = row.afterSaleRefundAmountYuan ?? 0
                const expanded = expandedOrderNos.has(row.orderNo)
                return (
                  <li
                    key={row.orderNo}
                    className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-rose-100 bg-white p-3 text-[11px] text-slate-700"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2 border-b border-rose-50 pb-2">
                      <p
                        className="min-w-0 truncate font-mono text-[12px] font-semibold text-slate-900"
                        title={row.orderNo}
                      >
                        {row.orderNo}
                      </p>
                      {row.qianfanDetailAvailable !== false ? (
                        <QianfanOrderDetailButton orderNo={row.orderNo} compact />
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-1 flex-col gap-0.5">
                      <p>
                        <span className="text-slate-500">买家：</span>
                        {row.buyerNickname || '—'}
                      </p>
                      <p>
                        <span className="text-slate-500">下单：</span>
                        {row.orderTime || '—'}
                      </p>
                      <p className="truncate" title={row.liveAccountName || ''}>
                        <span className="text-slate-500">来源直播号：</span>
                        {row.liveAccountName || '—'}
                      </p>
                      <p className="truncate">
                        <span className="text-slate-500">订单归属主播：</span>
                        {row.paymentAnchorName?.trim() || '—'}
                      </p>
                      <p className="line-clamp-2 break-words">
                        <span className="text-slate-500">官方品退原因：</span>
                        {officialReason}
                      </p>
                      <p>
                        <span className="text-slate-500">售后状态：</span>
                        {row.afterSaleStatus || '—'}
                      </p>
                      <p>
                        <span className="text-slate-500">退款金额：</span>
                        {refundYuan > 0 ? formatMoney(refundYuan) : '—'}
                      </p>
                    </div>
                    <div className="mt-2 border-t border-rose-50 pt-2">
                      <button
                        type="button"
                        className="text-[11px] font-medium text-rose-700"
                        onClick={() => toggleExpand(row.orderNo)}
                      >
                        {expanded ? '收起详情' : '展开详情'}
                      </button>
                      {expanded ? (
                        <div className="mt-1.5 space-y-1">
                          <p>包裹号：{row.packageId || '—'}</p>
                          <p>匹配方式：{row.qualitySourceLabel || '—'}</p>
                          <p>
                            品退归属主播：
                            {formatAnchorDisplayName(row.qualityAttributionAnchorName || anchorName)}
                          </p>
                          <p>
                            归属解释：
                            {row.orderAttributionSource || '—'}
                            {row.attributionExplain ? `｜${row.attributionExplain}` : ''}
                          </p>
                          {afterSaleNo ? (
                            <>
                              <p>
                                售后单号：{afterSaleNo}
                                <button
                                  type="button"
                                  className="ml-2 text-rose-600 hover:underline"
                                  onClick={() => copyText(afterSaleNo)}
                                >
                                  复制
                                </button>
                              </p>
                              <p>
                                最终售后理由：
                                {missingFinalReason
                                  ? '系统暂未同步到最终售后理由'
                                  : finalReason || '—'}
                              </p>
                            </>
                          ) : (
                            <p className="text-slate-500">售后单：暂无售后单信息</p>
                          )}
                          {row.extraHint ? (
                            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
                              {row.extraHint}
                            </p>
                          ) : null}
                          {row.qualityUnassignedReason ? (
                            <p className="text-amber-700">
                              归属异常原因：{row.qualityUnassignedReason}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </BoardDrawerShell>
  )
}
