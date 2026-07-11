import React, { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { useBossDashboard } from '../../providers/BossDashboardProvider'
import { BossIncomeTrendChart } from '../../components/boss/BossIncomeTrendChart'
import { BossScoreTrendChart } from '../../components/boss/BossScoreTrendChart'
import { BossScoreSparkline } from '../../components/boss/BossScoreSparkline'
import { centToDisplayYuan, deltaClass } from '../../lib/boss-dashboard-api'
import { formatDataFreshnessTime } from '../../lib/data-freshness'

const SCORE_ITEMS = [
  { key: 'qualityScore' as const, deltaKey: 'qualityDelta' as const, label: '品质分', trendKey: 'quality' as const, color: '#e11d48' },
  { key: 'logisticsScore' as const, deltaKey: 'logisticsDelta' as const, label: '物流分', trendKey: 'logistics' as const, color: '#0284c7' },
  { key: 'serviceScore' as const, deltaKey: 'serviceDelta' as const, label: '服务分', trendKey: 'service' as const, color: '#16a34a' },
]

export const BossDashboardPage: React.FC = () => {
  const { data, loading, error, refreshDisplay } = useBossDashboard()

  const updatedLine = useMemo(() => {
    if (!data?.lastBossSyncAt) return '平台数据最近更新时间：—'
    return `平台数据最近更新时间：${formatDataFreshnessTime(data.lastBossSyncAt)}`
  }, [data?.lastBossSyncAt])

  if (!data && loading) {
    return (
      <div className="w-full min-w-0 rounded-2xl bg-white p-8 text-sm text-slate-500">
        正在读取老板看板数据…
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 md:p-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">老板查看</h2>
          <p className="mt-1 text-xs text-slate-500">{updatedLine}</p>
          {error ? (
            <p className="mt-1 text-xs text-amber-600">本次读取异常：{error}（已保留上次数据）</p>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          onClick={() => void refreshDisplay()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新显示
        </button>
      </div>

      {data ? (
        <>
          <section className="grid w-full min-w-0 grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            {[
              ['四店可提现', data.totals.availableAmountCent],
              ['提现处理中', data.totals.withdrawingAmountCent],
              ['累计已提现', data.totals.withdrawnAmountCent],
              ['售后冻结', data.totals.afterSaleFrozenAmountCent],
              ['今日到账', data.totals.todayIncomeCent],
              ['体验分下降店铺', data.totals.scoreDownShopCount, true],
              ['不可提现店铺', data.totals.cannotWithdrawShopCount, true],
            ].map(([label, value, isCount]) => (
              <div
                key={String(label)}
                className="min-w-0 rounded-2xl border border-slate-100 bg-white p-3 md:p-4"
              >
                <div className="text-xs text-slate-500">{label}</div>
                <div
                  className={`mt-1 text-base font-semibold md:text-lg ${
                    label === '体验分下降店铺' || label === '不可提现店铺'
                      ? Number(value) > 0
                        ? 'text-rose-600'
                        : 'text-slate-800'
                      : 'text-slate-900'
                  }`}
                >
                  {isCount ? String(value ?? 0) : centToDisplayYuan(Number(value ?? 0))}
                </div>
              </div>
            ))}
          </section>

          <section className="w-full min-w-0 rounded-2xl border border-slate-100 bg-white p-4 md:p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">近12个月到账趋势</h3>
            <BossIncomeTrendChart points={data.combinedMonthlyIncome} />
          </section>

          <div className="grid w-full min-w-0 gap-5 xl:grid-cols-2">
            {data.shops.map((shop) => (
              <section
                key={shop.shopKey}
                id={`shop-${shop.shopKey}`}
                className="flex min-w-0 flex-col rounded-2xl border border-slate-100 bg-white p-4 md:p-5"
              >
                <div className="mb-4 flex min-w-0 items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <h3 className="truncate text-base font-semibold text-slate-900">{shop.shopName}</h3>
                  <span className="shrink-0 text-xs text-slate-500">
                    {shop.fund?.lastSyncedAt
                      ? formatDataFreshnessTime(shop.fund.lastSyncedAt)
                      : '未同步'}
                  </span>
                </div>

                <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="min-w-0 space-y-4">
                    <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
                      <div className="min-w-0">
                        可提现：
                        <span className="font-medium">{centToDisplayYuan(shop.fund?.availableAmountCent)}</span>
                      </div>
                      <div className="min-w-0">
                        账户余额：
                        <span className="font-medium">{centToDisplayYuan(shop.fund?.balanceAmountCent)}</span>
                      </div>
                      <div className="min-w-0">
                        提现处理中：
                        <span className="font-medium">{centToDisplayYuan(shop.fund?.withdrawingAmountCent)}</span>
                      </div>
                      <div className="min-w-0">
                        累计已提现：
                        <span className="font-medium">{centToDisplayYuan(shop.fund?.withdrawnAmountCent)}</span>
                      </div>
                      <div className="min-w-0">
                        售后冻结：
                        <span className="font-medium">{centToDisplayYuan(shop.fund?.afterSaleFrozenAmountCent)}</span>
                      </div>
                      <div className="min-w-0">
                        今日到账：
                        <span className="font-medium">{centToDisplayYuan(shop.fund?.todayIncomeCent)}</span>
                      </div>
                      <div className="min-w-0">
                        昨日入账：
                        <span className="font-medium">{centToDisplayYuan(shop.fund?.yesterdayIncomeCent)}</span>
                      </div>
                      <div className="min-w-0">
                        保证金：
                        <span className="font-medium">{centToDisplayYuan(shop.fund?.depositBalanceCent)}</span>
                      </div>
                    </div>

                    {shop.fund?.canWithdraw === false ? (
                      <p className="text-xs text-rose-600">
                        不可提现：{shop.fund.cannotWithdrawReason ?? '请查看平台原因'}
                      </p>
                    ) : null}
                    {shop.fund?.isStale && shop.fund.syncError ? (
                      <p className="text-xs text-amber-600">本次同步异常：{shop.fund.syncError}</p>
                    ) : null}

                    <div className="min-w-0">
                      <h4 className="mb-2 text-xs font-medium text-slate-700">近12个月到账趋势</h4>
                      <BossIncomeTrendChart
                        mode="shop"
                        shopKey={shop.shopKey}
                        points={shop.monthlyIncome.map((row) => ({
                          month: row.month,
                          amountCent: row.amountCent,
                          shiyuju: shop.shopKey === 'shiyuju' ? row.amountCent : 0,
                          hetianyayu: shop.shopKey === 'hetianyayu' ? row.amountCent : 0,
                          xiangyu: shop.shopKey === 'xiangyu' ? row.amountCent : 0,
                          xyxiangyu: shop.shopKey === 'xyxiangyu' ? row.amountCent : 0,
                        }))}
                        height={160}
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h4 className="text-xs font-medium text-slate-700">
                          {shop.score?.scoreLabel ?? '平台分项体验分'}
                        </h4>
                        <span className="text-xs text-slate-500">{shop.score?.scoreDate ?? '—'}</span>
                      </div>
                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                        {SCORE_ITEMS.map((item) => {
                          const delta = shop.score?.[item.deltaKey]
                          return (
                          <div
                            key={item.key}
                            className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/40 p-3 md:p-4"
                          >
                            <div className="text-xs text-slate-500">{item.label}</div>
                            <div className="mt-1 text-2xl font-semibold text-slate-900">
                              {shop.score?.[item.key] ?? '—'}
                            </div>
                            <div className={`mt-0.5 text-xs ${deltaClass(delta)}`}>
                              {delta == null ? '较前日 —' : `较前日 ${delta > 0 ? '+' : ''}${delta}`}
                            </div>
                            <BossScoreSparkline
                              points={shop.scoreTrend[item.trendKey]}
                              color={item.color}
                            />
                          </div>
                          )
                        })}
                      </div>
                      <div className="mt-4 min-w-0">
                        <h4 className="mb-2 text-xs font-medium text-slate-700">近14天体验分趋势</h4>
                        <BossScoreTrendChart
                          quality={shop.scoreTrend.quality}
                          logistics={shop.scoreTrend.logistics}
                          service={shop.scoreTrend.service}
                        />
                      </div>
                    </div>
                  </div>

                  <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
                    <h4 className="mb-2 text-xs font-medium text-slate-700">经营建议</h4>
                    <div className="space-y-2">
                      {shop.advice.map((item, idx) => (
                        <p
                          key={idx}
                          className={`rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
                            item.level === 'danger'
                              ? 'border border-rose-200 bg-rose-50/50 text-rose-700'
                              : item.level === 'warning'
                                ? 'border border-amber-200 bg-amber-50/50 text-amber-700'
                                : 'border border-slate-100 bg-slate-50/60 text-slate-600'
                          }`}
                        >
                          {item.text}
                        </p>
                      ))}
                    </div>
                  </aside>
                </div>
              </section>
            ))}
          </div>

          <section className="w-full min-w-0 rounded-2xl border border-slate-100 bg-white p-4 md:p-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">数据口径说明</h3>
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
              {data.dataNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  )
}
