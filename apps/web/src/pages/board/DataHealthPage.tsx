import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'

interface MonthlyCloseReport {
  month: string
  range: { startDate: string; endDate: string }
  generatedAt: string
  status: 'pass' | 'warning' | 'danger'
  canClose: boolean
  score: number
  summary: {
    validRevenueCent: number
    paidOrderCount: number
    validOrderCount: number
    refundOrderCount: number
    qualityRefundOrderCount: number
    unassignedOrderCount: number
    duplicateOrderCount: number
    moneyDiffCentTotal: number
    orderDiffTotal: number
  }
  blockers: string[]
  warnings: string[]
  checks: Array<{ key: string; title: string; status: string; note: string; diffCent?: number; diffCount?: number }>
  syncRisk: {
    status: string
    requestCount24h: number
    throttledCount24h: number
    failedCount24h: number
    circuitOpenCount24h: number
    note: string
  }
}

const STATUS_LABEL: Record<string, string> = {
  pass: '通过',
  warning: '注意',
  danger: '危险',
}

export const DataHealthPage: React.FC = () => {
  const { formatMoney, formatCount } = useAmountDisplay()
  const [report, setReport] = useState<MonthlyCloseReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const status = await apiRequest<{ latest: MonthlyCloseReport | null }>(
        '/api/board/monthly-close/status',
      )
      setReport(status.latest)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const statusClass =
    report?.status === 'pass'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : report?.status === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-red-200 bg-red-50 text-red-900'

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-1 sm:px-0">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">数据健康 / 月度结账</h2>
        <p className="mt-1 text-sm text-slate-500">
          每月 15 日 03:30（Asia/Shanghai）自动核对上个月数据，用于结账与复盘参考。
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">正在加载月度结账状态…</p>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : !report ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
          暂无自动结账报告。系统将在每月 15 号自动生成，或由管理员手动重跑。
        </p>
      ) : (
        <>
          <div className={`rounded-2xl border p-4 ${statusClass}`}>
            <p className="text-lg font-semibold">
              上个月结账状态：{STATUS_LABEL[report.status] ?? report.status}
            </p>
            <p className="mt-1 text-sm">
              结账月份：{report.month}（{report.range.startDate} ~ {report.range.endDate}）
            </p>
            <p className="text-sm">生成时间：{new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
            <p className="mt-2 text-sm font-medium">
              是否可以结账：{report.canClose ? '可以' : '不可以'}
            </p>
            <p className="mt-2 text-sm">
              {report.status === 'pass'
                ? '上个月数据已自动核对完成，可以用于结账和复盘。'
                : '上个月数据存在差异或风险，暂时不建议用于结账。请先处理下面列出的问题。'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard label="有效成交金额" value={formatMoney(report.summary.validRevenueCent / 100)} />
            <MetricCard label="支付订单数" value={formatCount(report.summary.paidOrderCount)} />
            <MetricCard label="有效订单数" value={formatCount(report.summary.validOrderCount)} />
            <MetricCard label="退款订单数" value={formatCount(report.summary.refundOrderCount)} />
            <MetricCard label="品退订单数" value={formatCount(report.summary.qualityRefundOrderCount)} />
            <MetricCard label="未归属订单数" value={formatCount(report.summary.unassignedOrderCount)} />
            <MetricCard label="重复订单数" value={formatCount(report.summary.duplicateOrderCount)} />
            <MetricCard
              label="金额差异（分）"
              value={formatCount(report.summary.moneyDiffCentTotal)}
              danger={report.summary.moneyDiffCentTotal > 0}
            />
            <MetricCard
              label="订单差异"
              value={formatCount(report.summary.orderDiffTotal)}
              danger={report.summary.orderDiffTotal > 0}
            />
          </div>

          {report.blockers.length > 0 ? (
            <section className="rounded-xl border border-red-200 bg-red-50/60 p-3">
              <h3 className="text-sm font-semibold text-red-900">需处理问题</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800">
                {report.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <h3 className="text-sm font-semibold text-slate-900">核对项</h3>
            <ul className="mt-2 space-y-2">
              {report.checks.map((c) => (
                <li key={c.key} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <span className="font-medium">{c.title}</span>
                  <span className="ml-2 text-xs text-slate-500">{STATUS_LABEL[c.status] ?? c.status}</span>
                  <p className="mt-0.5 text-xs text-slate-600">{c.note}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <h3 className="text-sm font-semibold text-slate-900">小红书接口风险</h3>
            <p className="mt-1 text-sm text-slate-600">{report.syncRisk.note}</p>
            <p className="mt-2 text-xs text-slate-500">
              24h 请求 {formatCount(report.syncRisk.requestCount24h)} · 冷却跳过{' '}
              {formatCount(report.syncRisk.throttledCount24h)} · 失败{' '}
              {formatCount(report.syncRisk.failedCount24h)} · 熔断{' '}
              {formatCount(report.syncRisk.circuitOpenCount24h)}
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function MetricCard(props: { label: string; value: string; danger?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${props.danger ? 'border-red-200 bg-red-50/40' : 'border-slate-100 bg-white'}`}
    >
      <p className="text-[11px] text-slate-500">{props.label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${props.danger ? 'text-red-800' : 'text-slate-900'}`}>
        {props.value}
      </p>
    </div>
  )
}
