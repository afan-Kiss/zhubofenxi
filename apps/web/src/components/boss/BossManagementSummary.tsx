import React from 'react'
import { Info } from 'lucide-react'
import type { BossDashboardPayload } from '../../lib/boss-dashboard-api'
import { centToDisplayYuan } from '../../lib/boss-dashboard-api'
import { formatDataFreshnessTime } from '../../lib/data-freshness'
import { BossCoverageHint, formatCoverageSub } from './BossCoverageHint'

interface Props {
  data: BossDashboardPayload
}

function MetricCard({
  title,
  amountCent,
  hint,
  sub,
  updatedAt,
  warn,
}: {
  title: string
  amountCent: number | null | undefined
  hint?: string
  sub?: React.ReactNode
  updatedAt?: string | null
  warn?: boolean
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm md:p-5">
      <div className="text-xs text-slate-500">{title}</div>
      <div
        className={`mt-2 text-2xl font-semibold tracking-tight md:text-3xl ${
          warn ? 'text-amber-700' : 'text-slate-900'
        }`}
      >
        {centToDisplayYuan(amountCent ?? null)}
      </div>
      {sub ? <div className="mt-2 text-xs text-slate-500">{sub}</div> : null}
      {hint ? (
        <div className="mt-2 flex items-start gap-1 text-[11px] leading-relaxed text-slate-400">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>{hint}</span>
        </div>
      ) : null}
      {updatedAt ? (
        <div className="mt-3 text-[11px] text-slate-400">更新 {formatDataFreshnessTime(updatedAt)}</div>
      ) : null}
    </div>
  )
}

export const BossManagementSummary: React.FC<Props> = ({ data }) => {
  const latestPendingAt = data.shops
    .map((s) => s.pendingSettlement.fetchedAt)
    .filter(Boolean)
    .sort()
    .reverse()[0]
  const cov = data.totals.coverage

  return (
    <section className="space-y-3">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="四店可提现"
          amountCent={data.totals.availableAmountCent}
          updatedAt={data.lastBossSyncAt}
          hint="平台当前可提现余额合计；缺店时不显示完整合计"
          sub={<BossCoverageHint coverage={cov?.availableAmountCent} />}
          warn={cov?.availableAmountCent ? !cov.availableAmountCent.complete : false}
        />
        <MetricCard
          title="待结算订单金额"
          amountCent={data.totals.pendingSettlementAmountCent}
          updatedAt={latestPendingAt}
          hint="平台预计待结算金额，订单取消、退款或延迟结算后可能变化，最终以实际到账为准。"
          sub={
            <>
              {data.totals.pendingSettlementOrderCount != null
                ? `共 ${data.totals.pendingSettlementOrderCount} 笔待结算`
                : null}
              {formatCoverageSub(cov?.pendingSettlementAmountCent) ? (
                <div>
                  <BossCoverageHint coverage={cov?.pendingSettlementAmountCent} />
                </div>
              ) : null}
            </>
          }
          warn={
            data.shops.some((s) => s.pendingSettlement.syncStatus === 'reconciliation_warning') ||
            (cov?.pendingSettlementAmountCent ? !cov.pendingSettlementAmountCent.complete : false)
          }
        />
        <MetricCard
          title="本月已结算净额"
          amountCent={data.totals.currentMonthSettlementNetCent}
          updatedAt={data.lastBossSyncAt}
          hint={
            data.commonDataThroughDate
              ? `本月日账单结算净额合计，共同截至 ${data.commonDataThroughDate}`
              : '本月日账单结算净额合计，进行中月份可能继续变化'
          }
          sub={<BossCoverageHint coverage={cov?.currentMonthSettlementNetCent} />}
          warn={
            cov?.currentMonthSettlementNetCent
              ? !cov.currentMonthSettlementNetCent.complete
              : false
          }
        />
        <MetricCard
          title="累计已提现"
          amountCent={data.totals.withdrawnAmountCent}
          updatedAt={data.lastBossSyncAt}
          hint="只统计提现成功流水；流水同步失败时不展示完整合计"
          sub={<BossCoverageHint coverage={cov?.withdrawnAmountCent} />}
          warn={cov?.withdrawnAmountCent ? !cov.withdrawnAmountCent.complete : false}
        />
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-100 bg-white/80 px-3 py-2 text-xs text-slate-600">
        <span>
          今日实际到账 {centToDisplayYuan(data.totals.todayIncomeCent)}
          {formatCoverageSub(cov?.todayIncomeCent)
            ? ` · ${formatCoverageSub(cov.todayIncomeCent)}`
            : ''}
        </span>
        <span className="text-slate-300">|</span>
        <span>昨日入账 {centToDisplayYuan(data.totals.yesterdayIncomeCent)}</span>
        <span className="text-slate-300">|</span>
        <span>昨日结算净额 {centToDisplayYuan(data.totals.yesterdaySettlementNetCent)}</span>
        <span className="text-slate-300">|</span>
        <span>售后冻结 {centToDisplayYuan(data.totals.afterSaleFrozenAmountCent)}</span>
        <span className="text-slate-300">|</span>
        <span>本月平台佣金 {centToDisplayYuan(data.totals.currentMonthCommissionCent)}</span>
        {data.totals.cannotWithdrawShopCount > 0 ? (
          <>
            <span className="text-slate-300">|</span>
            <span className="text-rose-600">不可提现店铺 {data.totals.cannotWithdrawShopCount}</span>
          </>
        ) : null}
        {data.totals.scoreDownShopCount > 0 ? (
          <>
            <span className="text-slate-300">|</span>
            <span className="text-amber-700">体验分下降店铺 {data.totals.scoreDownShopCount}</span>
          </>
        ) : null}
        {data.totals.billReconciliationWarningShopCount > 0 ? (
          <>
            <span className="text-slate-300">|</span>
            <span className="text-amber-700">
              账单待复核店铺 {data.totals.billReconciliationWarningShopCount}
            </span>
          </>
        ) : null}
      </div>
    </section>
  )
}
