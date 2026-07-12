import React from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import type { BossShopView } from '../../lib/boss-dashboard-api'
import { centToDisplayYuan } from '../../lib/boss-dashboard-api'
import { formatDataFreshnessTime } from '../../lib/data-freshness'
import { bossSparklineMargin } from './boss-chart-layout'

interface Props {
  shops: BossShopView[]
  selectedShopKey: string
  onSelect: (shopKey: string) => void
}

export const BossShopRankCards: React.FC<Props> = ({ shops, selectedShopKey, onSelect }) => {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">店铺资金排行</h3>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {shops.map((shop) => {
          const spark = shop.monthlyIncome.slice(-6).map((p) => ({
            month: p.month.slice(5),
            v: p.amountCent,
          }))
          const selected = shop.shopKey === selectedShopKey
          const rankOne = shop.rank === 1
          return (
            <button
              key={shop.shopKey}
              type="button"
              onClick={() => onSelect(shop.shopKey)}
              className={`min-w-0 rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:shadow-md ${
                rankOne ? 'border-amber-200/80' : 'border-slate-100'
              } ${selected ? 'ring-2 ring-slate-900/10' : ''}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                    {shop.rank}
                  </span>
                  <span className="truncate text-sm font-semibold text-slate-900">{shop.shopName}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  {shop.fund?.canWithdraw === false ? (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] text-rose-600">
                      不可提现
                    </span>
                  ) : null}
                  {shop.billReconciliationStatus === 'reconciliation_warning' ||
                  shop.pendingSettlement.syncStatus === 'reconciliation_warning' ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                      待复核
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1 text-xs text-slate-600">
                <div className="flex justify-between gap-2">
                  <span>当前可提现</span>
                  <span className="font-medium text-slate-900">
                    {centToDisplayYuan(shop.fund?.availableAmountCent)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>待结算订单金额</span>
                  <span className="font-medium text-slate-900">
                    {centToDisplayYuan(shop.pendingSettlement.amountCent)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>本月结算净额</span>
                  <span className="font-medium text-slate-900">
                    {centToDisplayYuan(shop.currentMonthBill.settlementNetCent)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>累计已提现</span>
                  <span className="font-medium text-slate-900">
                    {centToDisplayYuan(shop.fund?.withdrawnAmountCent)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>待结算订单数</span>
                  <span className="font-medium text-slate-900">
                    {shop.pendingSettlement.orderCount ?? '—'}
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1 text-[10px] text-slate-500">
                <span>品质 {shop.score?.qualityScore ?? '—'}</span>
                <span>物流 {shop.score?.logisticsScore ?? '—'}</span>
                <span>服务 {shop.score?.serviceScore ?? '—'}</span>
              </div>
              <div className="mt-2 h-8 w-full min-w-0">
                {spark.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={spark} margin={bossSparklineMargin(false)}>
                      <Line type="monotone" dataKey="v" stroke="#64748b" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full rounded bg-slate-50" />
                )}
              </div>
              <div className="mt-2 text-[10px] text-slate-400">
                {shop.fund?.lastSyncedAt
                  ? formatDataFreshnessTime(shop.fund.lastSyncedAt)
                  : '未同步'}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
