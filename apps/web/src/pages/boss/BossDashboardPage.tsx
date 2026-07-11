import React, { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { useBossDashboard } from '../../providers/BossDashboardProvider'
import { BossIncomeTrendChart } from '../../components/boss/BossIncomeTrendChart'
import { BossScoreTrendChart } from '../../components/boss/BossScoreTrendChart'
import { BossScoreSparkline } from '../../components/boss/BossScoreSparkline'
import {
  centToDisplayYuan,
  deltaClass,
} from '../../lib/boss-dashboard-api'
import { formatDataFreshnessTime } from '../../lib/data-freshness'

export const BossDashboardPage: React.FC = () => {
  const { data, loading, error, refreshDisplay } = useBossDashboard()

  const updatedLine = useMemo(() => {
    if (!data?.lastBossSyncAt) return '平台数据最近更新时间：—'
    return `平台数据最近更新时间：${formatDataFreshnessTime(data.lastBossSyncAt)}`
  }, [data?.lastBossSyncAt])

  if (!data && loading) {
    return <div className="rounded-2xl bg-white p-8 text-sm text-slate-500">正在读取老板看板数据…</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">老板查看</h2>
          <p className="mt-1 text-xs text-slate-500">{updatedLine}</p>
          {error ? <p className="mt-1 text-xs text-amber-600">本次读取异常：{error}（已保留上次数据）</p> : null}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          onClick={() => void refreshDisplay()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新显示
        </button>
      </div>

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['四店可提现', data.totals.availableAmountCent],
              ['提现处理中', data.totals.withdrawingAmountCent],
              ['累计已提现', data.totals.withdrawnAmountCent],
              ['售后冻结', data.totals.afterSaleFrozenAmountCent],
              ['今日到账', data.totals.todayIncomeCent],
              ['体验分下降店铺', data.totals.scoreDownShopCount, true],
              ['不可提现店铺', data.totals.cannotWithdrawShopCount, true],
            ].map(([label, value, isCount]) => (
              <div key={String(label)} className="rounded-2xl border border-slate-100 bg-white p-3">
                <div className="text-xs text-slate-500">{label}</div>
                <div
                  className={`mt-1 text-base font-semibold ${
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

          <section className="rounded-2xl border border-slate-100 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">近12个月到账趋势</h3>
            <BossIncomeTrendChart points={data.combinedMonthlyIncome} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {data.shops.map((shop) => (
              <section
                key={shop.shopKey}
                id={`shop-${shop.shopKey}`}
                className="rounded-2xl border border-slate-100 bg-white p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{shop.shopName}</h3>
                  <span className="text-xs text-slate-500">
                    {shop.fund?.lastSyncedAt
                      ? formatDataFreshnessTime(shop.fund.lastSyncedAt)
                      : '未同步'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>可提现：<span className="font-medium">{centToDisplayYuan(shop.fund?.availableAmountCent)}</span></div>
                  <div>账户余额：<span className="font-medium">{centToDisplayYuan(shop.fund?.balanceAmountCent)}</span></div>
                  <div>提现处理中：<span className="font-medium">{centToDisplayYuan(shop.fund?.withdrawingAmountCent)}</span></div>
                  <div>累计已提现：<span className="font-medium">{centToDisplayYuan(shop.fund?.withdrawnAmountCent)}</span></div>
                  <div>售后冻结：<span className="font-medium">{centToDisplayYuan(shop.fund?.afterSaleFrozenAmountCent)}</span></div>
                  <div>今日到账：<span className="font-medium">{centToDisplayYuan(shop.fund?.todayIncomeCent)}</span></div>
                  <div>昨日入账：<span className="font-medium">{centToDisplayYuan(shop.fund?.yesterdayIncomeCent)}</span></div>
                  <div>保证金：<span className="font-medium">{centToDisplayYuan(shop.fund?.depositBalanceCent)}</span></div>
                </div>

                {shop.fund?.canWithdraw === false ? (
                  <p className="mt-2 text-xs text-rose-600">
                    不可提现：{shop.fund.cannotWithdrawReason ?? '请查看平台原因'}
                  </p>
                ) : null}
                {shop.fund?.isStale && shop.fund.syncError ? (
                  <p className="mt-2 text-xs text-amber-600">本次同步异常：{shop.fund.syncError}</p>
                ) : null}

                <div className="mt-4">
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
                    height={180}
                  />
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-medium text-slate-700">
                      {shop.score?.scoreLabel ?? '平台分项体验分'}
                    </h4>
                    <span className="text-xs text-slate-500">{shop.score?.scoreDate ?? '—'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'qualityScore', label: '品质分', delta: shop.score?.qualityDelta, trend: shop.scoreTrend.quality, color: '#e11d48' },
                      { key: 'logisticsScore', label: '物流分', delta: shop.score?.logisticsDelta, trend: shop.scoreTrend.logistics, color: '#0284c7' },
                      { key: 'serviceScore', label: '服务分', delta: shop.score?.serviceDelta, trend: shop.scoreTrend.service, color: '#16a34a' },
                    ].map((item) => (
                      <div key={item.key} className="rounded-xl border border-slate-100 p-2">
                        <div className="text-xs text-slate-500">{item.label}</div>
                        <div className="text-lg font-semibold text-slate-900">
                          {shop.score?.[item.key as 'qualityScore'] ?? '—'}
                        </div>
                        <div className={`text-xs ${deltaClass(item.delta)}`}>
                          {item.delta == null ? '较前日 —' : `较前日 ${item.delta > 0 ? '+' : ''}${item.delta}`}
                        </div>
                        <BossScoreSparkline points={item.trend} color={item.color} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <h4 className="mb-2 text-xs font-medium text-slate-700">近14天体验分趋势</h4>
                    <BossScoreTrendChart
                      quality={shop.scoreTrend.quality}
                      logistics={shop.scoreTrend.logistics}
                      service={shop.scoreTrend.service}
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <h4 className="text-xs font-medium text-slate-700">经营建议</h4>
                  {shop.advice.map((item, idx) => (
                    <p
                      key={idx}
                      className={`rounded-xl px-3 py-2 text-xs ${
                        item.level === 'danger'
                          ? 'border border-rose-200 text-rose-700'
                          : item.level === 'warning'
                            ? 'border border-amber-200 text-amber-700'
                            : 'border border-slate-100 text-slate-600'
                      }`}
                    >
                      {item.text}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <section className="rounded-2xl border border-slate-100 bg-white p-4">
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
