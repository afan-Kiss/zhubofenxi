import React, { useMemo } from 'react'
import type { BossShopView } from '../../lib/boss-dashboard-api'
import { centToDisplayYuan, deltaClass } from '../../lib/boss-dashboard-api'
import { BossIncomeTrendChart } from './BossIncomeTrendChart'
import { BossScoreTrendChart } from './BossScoreTrendChart'
import { BossScoreSparkline } from './BossScoreSparkline'

const SCORE_ITEMS = [
  { key: 'qualityScore' as const, deltaKey: 'qualityDelta' as const, label: '品质分', trendKey: 'quality' as const, color: '#e11d48' },
  { key: 'logisticsScore' as const, deltaKey: 'logisticsDelta' as const, label: '物流分', trendKey: 'logistics' as const, color: '#0284c7' },
  { key: 'serviceScore' as const, deltaKey: 'serviceDelta' as const, label: '服务分', trendKey: 'service' as const, color: '#16a34a' },
]

interface Props {
  shop: BossShopView
}

export const BossShopDetailPanel: React.FC<Props> = ({ shop }) => {
  const incomeTrend = useMemo(
    () =>
      shop.monthlyIncome.map((row) => ({
        month: row.month,
        amountCent: row.amountCent,
        shiyuju: shop.shopKey === 'shiyuju' ? row.amountCent : null,
        hetianyayu: shop.shopKey === 'hetianyayu' ? row.amountCent : null,
        xiangyu: shop.shopKey === 'xiangyu' ? row.amountCent : null,
        xyxiangyu: shop.shopKey === 'xyxiangyu' ? row.amountCent : null,
      })),
    [shop],
  )

  const settlementTrend = useMemo(
    () =>
      shop.monthlySettlementTrend.map((row) => ({
        month: row.month,
        amountCent: row.amountCent,
        shiyuju: shop.shopKey === 'shiyuju' ? row.amountCent : null,
        hetianyayu: shop.shopKey === 'hetianyayu' ? row.amountCent : null,
        xiangyu: shop.shopKey === 'xiangyu' ? row.amountCent : null,
        xyxiangyu: shop.shopKey === 'xyxiangyu' ? row.amountCent : null,
      })),
    [shop],
  )

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{shop.shopName}</h3>
          <p className="text-xs text-slate-500">店铺资金详情</p>
        </div>
        {shop.pendingSettlement.syncStatus !== 'success' && shop.pendingSettlement.syncError ? (
          <span className="text-xs text-amber-600">
            本轮账单暂未更新，当前展示上次成功数据
          </span>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-4">
          <h4 className="text-xs font-medium text-slate-700">核心资金</h4>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">当前可提现</span>
              <span className="font-semibold">{centToDisplayYuan(shop.fund?.availableAmountCent)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">待结算订单金额</span>
              <span className="font-semibold">{centToDisplayYuan(shop.pendingSettlement.amountCent)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">本月结算净额</span>
              <span className="font-semibold">{centToDisplayYuan(shop.currentMonthBill.settlementNetCent)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">昨日结算净额</span>
              <span className="font-semibold">
                {centToDisplayYuan(shop.yesterdaySettlement?.settlementNetCent)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">昨日入账</span>
              <span className="font-semibold">{centToDisplayYuan(shop.fund?.yesterdayIncomeCent)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-4">
          <h4 className="text-xs font-medium text-slate-700">待结算</h4>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">预计金额</span>
              <span className="font-semibold">{centToDisplayYuan(shop.pendingSettlement.amountCent)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">待结算笔数</span>
              <span className="font-semibold">{shop.pendingSettlement.orderCount ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">结算周期</span>
              <span className="font-semibold">
                {shop.pendingSettlement.settlePeriodDays != null
                  ? `${shop.pendingSettlement.settlePeriodDays} 天`
                  : shop.fund?.statementPeriodDays != null
                    ? `${shop.fund.statementPeriodDays} 天`
                    : '—'}
              </span>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            预计金额，最终以实际到账为准。
          </p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-4">
          <h4 className="text-xs font-medium text-slate-700">账单构成（本月）</h4>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">结算入账</span>
              <span>{centToDisplayYuan(shop.currentMonthBill.statementInCent)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">订单退款</span>
              <span>{centToDisplayYuan(shop.currentMonthBill.statementRefundCent)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">平台佣金</span>
              <span>{centToDisplayYuan(shop.currentMonthBill.commissionCent)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-2">
        <div className="min-w-0">
          <h4 className="mb-2 text-xs font-medium text-slate-700">实际到账趋势</h4>
          <BossIncomeTrendChart mode="shop" shopKey={shop.shopKey} points={incomeTrend} height={180} />
        </div>
        <div className="min-w-0">
          <h4 className="mb-2 text-xs font-medium text-slate-700">结算净额趋势</h4>
          <BossIncomeTrendChart mode="shop" shopKey={shop.shopKey} points={settlementTrend} height={180} />
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-slate-700">{shop.score?.scoreLabel ?? '平台分项体验分'}</h4>
          <span className="text-xs text-slate-500">{shop.score?.scoreDate ?? '—'}</span>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          {SCORE_ITEMS.map((item) => {
            const delta = shop.score?.[item.deltaKey]
            return (
              <div key={item.key} className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
                <div className="text-xs text-slate-500">{item.label}</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{shop.score?.[item.key] ?? '—'}</div>
                <div className={`mt-0.5 text-xs ${deltaClass(delta)}`}>
                  {delta == null ? '较前日 —' : `较前日 ${delta > 0 ? '+' : ''}${delta}`}
                </div>
                <BossScoreSparkline points={shop.scoreTrend[item.trendKey]} color={item.color} />
              </div>
            )
          })}
        </div>
        <div className="mt-4 min-w-0">
          <BossScoreTrendChart
            quality={shop.scoreTrend.quality}
            logistics={shop.scoreTrend.logistics}
            service={shop.scoreTrend.service}
            height={160}
          />
        </div>
      </div>

      {shop.advice.length > 0 ? (
        <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/30 p-4">
          <h4 className="text-xs font-medium text-slate-700">经营建议</h4>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {shop.advice.map((item, idx) => (
              <li key={idx}>{item.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="mt-5 rounded-xl border border-slate-100 bg-white p-4">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">更多资金信息</summary>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
          <div>账户余额 {centToDisplayYuan(shop.fund?.balanceAmountCent)}</div>
          <div>提现处理中 {centToDisplayYuan(shop.fund?.withdrawingAmountCent)}</div>
          <div>售后冻结 {centToDisplayYuan(shop.fund?.afterSaleFrozenAmountCent)}</div>
          <div>保证金 {centToDisplayYuan(shop.fund?.depositBalanceCent)}</div>
          <div>昨日入账 {centToDisplayYuan(shop.fund?.yesterdayIncomeCent)}</div>
          <div>
            结算周期{' '}
            {shop.fund?.statementPeriodDays != null ? `${shop.fund.statementPeriodDays} 天` : '—'}
          </div>
        </div>
        {shop.fund?.canWithdraw === false ? (
          <p className="mt-2 text-xs text-rose-600">
            不可提现：{shop.fund.cannotWithdrawReason ?? '请查看平台原因'}
          </p>
        ) : null}
      </details>
    </section>
  )
}
