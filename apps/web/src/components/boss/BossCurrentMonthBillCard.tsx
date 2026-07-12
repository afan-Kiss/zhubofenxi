import React from 'react'
import type { BossDashboardPayload } from '../../lib/boss-dashboard-api'
import { centToDisplayYuan } from '../../lib/boss-dashboard-api'

interface Props {
  data: BossDashboardPayload
  onOpenDetail: () => void
}

export const BossCurrentMonthBillCard: React.FC<Props> = ({ data, onOpenDetail }) => {
  const statementIn = data.shops.reduce((acc, s) => acc + (s.currentMonthBill.statementInCent ?? 0), 0)
  const statementRefund = data.shops.reduce(
    (acc, s) => acc + (s.currentMonthBill.statementRefundCent ?? 0),
    0,
  )
  const otherFee = data.shops.reduce((acc, s) => acc + (s.currentMonthBill.otherFeeCent ?? 0), 0)
  const commission = data.totals.currentMonthCommissionCent
  const settleOrders = data.shops.reduce(
    (acc, s) => acc + (s.currentMonthBill.settleOrderCount ?? 0),
    0,
  )
  const throughDate =
    data.shops
      .map((s) => s.currentMonthBill.dataThroughDate)
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? null

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">本月结算账单</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            数据截至 {throughDate ?? '—'}
            {data.shops.some((s) => s.currentMonthBill.isPartialMonth) ? '（进行中）' : ''}
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          onClick={onOpenDetail}
        >
          查看账单明细
        </button>
      </div>
      <div className="grid min-w-0 gap-4 md:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="text-xs text-slate-500">本月结算净额</div>
          <div className="mt-1 text-3xl font-semibold text-slate-900">
            {centToDisplayYuan(data.totals.currentMonthSettlementNetCent)}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            结算净额直接使用平台账单 totalChangeAmount，平台佣金不会再次扣除。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-slate-500">订单结算入账</div>
            <div className="mt-1 font-medium text-slate-900">{centToDisplayYuan(statementIn)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">订单退款</div>
            <div className="mt-1 font-medium text-slate-900">{centToDisplayYuan(statementRefund)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">其他收支</div>
            <div className="mt-1 font-medium text-slate-900">{centToDisplayYuan(otherFee)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">平台佣金</div>
            <div className="mt-1 font-medium text-slate-900">{centToDisplayYuan(commission)}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-slate-500">已结算订单数</div>
            <div className="mt-1 font-medium text-slate-900">{settleOrders || '—'}</div>
          </div>
        </div>
      </div>
    </section>
  )
}
