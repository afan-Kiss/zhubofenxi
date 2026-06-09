import React, { useMemo, useState } from 'react'
import type { AnalyzedOrderView, BusinessAnalysisResult } from '../types/business'
import { formatCentToMoney, formatRate } from '../lib/businessAnalyzer'

const TABS = [
  '主播汇总',
  '买家退货排行',
  '买家品退排行',
  '退货/品退明细',
  '异常提醒',
] as const

interface BusinessTabPanelProps {
  result: BusinessAnalysisResult | null
  buyerFilter: string | null
  hasBuyerField: boolean
  onSelectBuyer: (buyerId: string) => void
  onClearBuyerFilter: () => void
}

export const BusinessTabPanel: React.FC<BusinessTabPanelProps> = ({
  result,
  buyerFilter,
  hasBuyerField,
  onSelectBuyer,
  onClearBuyerFilter,
}) => {
  const [tab, setTab] = useState<(typeof TABS)[number]>('主播汇总')

  const filteredOrders = useMemo(() => {
    if (!result) return []
    let list = result.analyzedOrders
    if (buyerFilter) {
      list = list.filter((o) => o.buyerId === buyerFilter)
    }
    if (tab === '退货/品退明细') {
      list = list.filter((o) => o.isRefunded || o.isQualityReturn)
    }
    return list
  }, [result, buyerFilter, tab])

  if (!result) {
    return (
      <section className="flex h-[130px] shrink-0 flex-col overflow-hidden rounded-2xl border border-white/70 bg-[var(--color-card)] shadow-sm">
        <TabBar active={tab} onChange={setTab} />
        <div className="flex flex-1 items-center justify-center text-[11px] text-slate-400">
          上传四张表后点击「开始分析」查看明细
        </div>
      </section>
    )
  }

  return (
    <section className="flex h-[130px] shrink-0 flex-col overflow-hidden rounded-2xl border border-white/70 bg-[var(--color-card)] shadow-sm">
      <TabBar active={tab} onChange={setTab} />
      {buyerFilter && (
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-rose-50/50 px-2 py-0.5 text-[10px]">
          <span>筛选买家：{buyerFilter}</span>
          <button type="button" className="text-[var(--color-xhs-red)]" onClick={onClearBuyerFilter}>
            清除
          </button>
        </div>
      )}
      <div className="xhs-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {tab === '主播汇总' && <AnchorTab summaries={result.anchorSummaries} />}
        {tab === '买家退货排行' && (
          <BuyerReturnTab
            ranking={result.buyerReturnRanking}
            hasBuyerField={hasBuyerField}
            onSelect={onSelectBuyer}
          />
        )}
        {tab === '买家品退排行' && (
          <BuyerQualityTab
            ranking={result.buyerQualityReturnRanking}
            hasBuyerField={hasBuyerField}
            onSelect={onSelectBuyer}
          />
        )}
        {tab === '退货/品退明细' && <OrderDetailTab orders={filteredOrders} />}
        {tab === '异常提醒' && (
          <AbnormalTab
            abnormal={result.abnormalOrders}
            warnings={result.warnings}
            overview={result.overview}
          />
        )}
      </div>
    </section>
  )
}

function TabBar({
  active,
  onChange,
}: {
  active: string
  onChange: (t: (typeof TABS)[number]) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-slate-100 bg-slate-50/50 px-2">
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`relative px-2 py-1.5 text-[10px] font-medium ${
            active === t ? 'text-slate-900' : 'text-slate-400'
          }`}
        >
          {t}
          {active === t && (
            <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-[var(--color-xhs-red)]" />
          )}
        </button>
      ))}
    </div>
  )
}

function AnchorTab({ summaries }: { summaries: BusinessAnalysisResult['anchorSummaries'] }) {
  return (
    <table className="w-full text-[10px]">
      <thead className="text-slate-500">
        <tr>
          <th className="py-0.5 text-left">主播</th>
          <th className="text-left">GMV</th>
          <th className="text-left">占比</th>
          <th className="text-left">签收</th>
          <th className="text-left">退货率</th>
          <th className="text-left">品退</th>
          <th className="text-left">毛利</th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((a) => (
          <tr key={a.anchorName} className="border-t border-slate-50">
            <td className="py-0.5 font-medium">{a.anchorName}</td>
            <td>{formatCentToMoney(a.gmvCent)}</td>
            <td>{formatRate(a.gmvShare)}</td>
            <td>
              {a.actualSignedCount} / {formatCentToMoney(a.actualSignedAmountCent)}
            </td>
            <td>{formatRate(a.returnRate)}</td>
            <td>
              {a.qualityReturnCount} / {formatCentToMoney(a.qualityReturnAmountCent)}
            </td>
            <td>{formatCentToMoney(a.grossProfitCent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BuyerReturnTab({
  ranking,
  hasBuyerField,
  onSelect,
}: {
  ranking: BusinessAnalysisResult['buyerReturnRanking']
  hasBuyerField: boolean
  onSelect: (id: string) => void
}) {
  if (!hasBuyerField) {
    return <p className="text-[10px] text-slate-500">未识别到买家 ID，无法生成买家退货排名。</p>
  }
  return (
    <table className="w-full text-[10px]">
      <thead className="text-slate-500">
        <tr>
          <th>#</th>
          <th className="text-left">买家ID</th>
          <th className="text-left">退货单数</th>
          <th className="text-left">退货金额</th>
          <th className="text-left">最近退货</th>
        </tr>
      </thead>
      <tbody>
        {ranking.map((r, i) => (
          <tr
            key={r.buyerId}
            className="cursor-pointer border-t border-slate-50 hover:bg-rose-50/50"
            onClick={() => onSelect(r.buyerId)}
          >
            <td>{i + 1}</td>
            <td>{r.buyerId}</td>
            <td>{r.returnCount}</td>
            <td>{formatCentToMoney(r.returnAmountCent)}</td>
            <td>{r.latestReturnTime}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BuyerQualityTab({
  ranking,
  hasBuyerField,
  onSelect,
}: {
  ranking: BusinessAnalysisResult['buyerQualityReturnRanking']
  hasBuyerField: boolean
  onSelect: (id: string) => void
}) {
  if (!hasBuyerField) {
    return <p className="text-[10px] text-slate-500">未识别到买家 ID，无法生成买家品退排名。</p>
  }
  return (
    <table className="w-full text-[10px]">
      <thead className="text-slate-500">
        <tr>
          <th>#</th>
          <th className="text-left">买家ID</th>
          <th className="text-left">品退单数</th>
          <th className="text-left">品退金额</th>
          <th className="text-left">原因摘要</th>
        </tr>
      </thead>
      <tbody>
        {ranking.map((r, i) => (
          <tr
            key={r.buyerId}
            className="cursor-pointer border-t border-slate-50 hover:bg-rose-50/50"
            onClick={() => onSelect(r.buyerId)}
          >
            <td>{i + 1}</td>
            <td>{r.buyerId}</td>
            <td>{r.qualityReturnCount}</td>
            <td>{formatCentToMoney(r.qualityReturnAmountCent)}</td>
            <td className="max-w-[120px] truncate">{r.reasonSummary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function OrderDetailTab({ orders }: { orders: AnalyzedOrderView[] }) {
  return (
    <table className="w-full text-[10px]">
      <thead className="text-slate-500">
        <tr>
          <th className="text-left">订单号</th>
          <th className="text-left">买家</th>
          <th className="text-left">主播</th>
          <th className="text-left">GMV</th>
          <th className="text-left">类型</th>
          <th className="text-left">金额来源</th>
        </tr>
      </thead>
      <tbody>
        {orders.slice(0, 80).map((o) => (
          <tr key={`${o.orderId}-${o.sourceRowIndex}`} className="border-t border-slate-50">
            <td className="max-w-[90px] truncate">{o.orderId}</td>
            <td>{o.buyerId}</td>
            <td>{o.anchorName}</td>
            <td>{formatCentToMoney(o.gmvCent)}</td>
            <td>
              {o.isQualityReturn ? '品退' : o.isRefunded ? '退货' : o.isActualSigned ? '签收' : '—'}
            </td>
            <td>
              {o.returnAmountSource === 'bill'
                ? '账单退款'
                : o.returnAmountSource === 'order_estimate'
                  ? '订单估算'
                  : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AbnormalTab({
  abnormal,
  warnings,
  overview,
}: {
  abnormal: AnalyzedOrderView[]
  warnings: string[]
  overview: BusinessAnalysisResult['overview']
}) {
  return (
    <div className="space-y-1 text-[10px]">
      <p className="text-amber-700">
        异常订单 {overview.abnormalOrderCount} · 未归属 {overview.unassignedOrderCount} ·
        账单未匹配 {overview.unmatchedBillOrderCount}
      </p>
      {warnings.map((w) => (
        <p key={w} className="text-slate-600">
          · {w}
        </p>
      ))}
      {abnormal.slice(0, 20).map((o) => (
        <p key={o.sourceRowIndex} className="text-slate-500">
          行 {o.sourceRowIndex + 1}：{o.orderId} — {o.errors.join('；') || '数据异常'}
        </p>
      ))}
    </div>
  )
}
