import React, { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useBossDashboard } from '../../providers/BossDashboardProvider'
import { BossManagementSummary } from '../../components/boss/BossManagementSummary'
import { BossMoneyTrendChart } from '../../components/boss/BossMoneyTrendChart'
import { BossCurrentMonthBillCard } from '../../components/boss/BossCurrentMonthBillCard'
import { BossShopRankCards } from '../../components/boss/BossShopRankCards'
import { BossShopDetailPanel } from '../../components/boss/BossShopDetailPanel'
import { BossBillDrawer } from '../../components/boss/BossBillDrawer'
import { BossDataNotes } from '../../components/boss/BossDataNotes'
import { formatDataFreshnessTime } from '../../lib/data-freshness'

export const BossDashboardPage: React.FC = () => {
  const { data, loading, error, refreshDisplay } = useBossDashboard()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedShopKey, setSelectedShopKey] = useState<string | null>(null)

  const rankedShops = data?.shops ?? []
  const selectedShop = useMemo(() => {
    if (!rankedShops.length) return null
    const key = selectedShopKey ?? rankedShops[0]?.shopKey
    return rankedShops.find((s) => s.shopKey === key) ?? rankedShops[0] ?? null
  }, [rankedShops, selectedShopKey])

  const updatedLine = useMemo(() => {
    if (!data) return '数据新鲜度：—'
    const attempt = data.lastAttemptAt
      ? `${formatDataFreshnessTime(data.lastAttemptAt)}（${data.lastAttemptStatus ?? '未知'}）`
      : '—'
    const success = data.lastSuccessfulRunAt
      ? formatDataFreshnessTime(data.lastSuccessfulRunAt)
      : '—'
    const oldestShop = [...(data.shops ?? [])]
      .map((s) => ({
        name: s.shopName,
        at: s.fund?.lastSyncedAt ?? null,
      }))
      .filter((s) => s.at)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))[0]
    const oldest = oldestShop
      ? `${oldestShop.name} ${formatDataFreshnessTime(oldestShop.at)}`
      : '—'
    return `最近同步尝试：${attempt} · 最近整次成功：${success} · 数据最旧店铺：${oldest}`
  }, [data])

  if (!data && loading) {
    return (
      <div className="mx-auto w-full max-w-[1440px] min-w-0 rounded-2xl bg-[#f7f7f5] p-8 text-sm text-slate-500">
        正在读取老板看板数据…
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] min-w-0 space-y-5 bg-[#f7f7f5] pb-8">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm md:p-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">老板查看</h2>
          <p className="mt-1 text-xs text-slate-500">{updatedLine}</p>
          {error ? (
            <p className="mt-1 text-xs text-amber-600">本次读取异常：{error}（已保留上次数据）</p>
          ) : null}
          {data?.lastBossSyncStatus === 'partial_success' ? (
            <p className="mt-1 text-xs text-amber-600">部分店铺本轮同步未完成，页面展示上次成功数据</p>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          onClick={() => void refreshDisplay()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新显示
        </button>
      </div>

      {data ? (
        <>
          <BossManagementSummary data={data} />

          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm md:p-5">
            <BossMoneyTrendChart
              incomePoints={data.combinedMonthlyIncome}
              settlementPoints={data.combinedMonthlySettlement}
            />
          </section>

          <BossCurrentMonthBillCard data={data} onOpenDetail={() => setDrawerOpen(true)} />

          <BossShopRankCards
            shops={data.shops}
            selectedShopKey={selectedShop?.shopKey ?? ''}
            onSelect={setSelectedShopKey}
          />

          {selectedShop ? <BossShopDetailPanel shop={selectedShop} /> : null}

          <BossDataNotes notes={data.dataNotes} />
        </>
      ) : null}

      <BossBillDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
