import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'

interface DirectRequestFinding {
  file: string
  line: number
  risk: 'low' | 'medium' | 'high'
  reason: string
  suggestion: string
}

interface SyncRiskStatus {
  status: string
  requestCount24h: number
  throttledCount24h: number
  failedCount24h: number
  circuitOpenCount24h: number
  highRiskApis: string[]
  directRequestFindings?: DirectRequestFinding[]
  note: string
}

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
  checks: Array<{
    key: string
    title: string
    status: string
    note: string
    diffCent?: number
    diffCount?: number
    sampleBuyerKeys?: string[]
    sampleOrderIds?: string[]
  }>
  syncRisk: SyncRiskStatus
  schedulerRegistered?: boolean
}

const STATUS_LABEL: Record<string, string> = {
  pass: '通过',
  warning: '注意',
  danger: '危险',
}

export const DataHealthPage: React.FC = () => {
  const { formatMoney, formatCount } = useAmountDisplay()
  const [report, setReport] = useState<MonthlyCloseReport | null>(null)
  const [syncRisk, setSyncRisk] = useState<SyncRiskStatus | null>(null)
  const [schedulerRegistered, setSchedulerRegistered] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [status, risk] = await Promise.all([
        apiRequest<{
          latest: MonthlyCloseReport | null
          schedulerRegistered?: boolean
        }>('/api/board/monthly-close/status'),
        apiRequest<SyncRiskStatus>('/api/board/sync-risk/status'),
      ])
      setReport(status.latest)
      setSchedulerRegistered(status.schedulerRegistered ?? status.latest?.schedulerRegistered ?? null)
      setSyncRisk(risk)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
      setReport(null)
      setSyncRisk(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleRerun = async () => {
    setRerunning(true)
    setRerunError(null)
    try {
      await apiRequest('/api/board/monthly-close/rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      await load()
    } catch (e) {
      setRerunError(e instanceof Error ? e.message : '重跑失败')
    } finally {
      setRerunning(false)
    }
  }

  const risk = syncRisk ?? report?.syncRisk
  const statusClass =
    report?.status === 'pass'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : report?.status === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : report?.status === 'danger'
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-slate-200 bg-slate-50 text-slate-800'

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-1 sm:px-0">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">数据健康 / 月度结账</h2>
        <p className="mt-1 text-sm text-slate-500">
          每月 15 日 03:30（Asia/Shanghai）自动核对上个月数据，用于结账与复盘参考。
        </p>
      </div>

      {schedulerRegistered === false ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          月度结账调度未注册：生产环境可能不会自动执行每月 15 号任务，请联系管理员检查服务启动日志。
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">正在加载月度结账状态…</p>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : !report ? (
        <div className="space-y-3">
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
            暂无自动结账报告。系统将在每月 15 号自动生成。
          </p>
          <button
            type="button"
            onClick={() => void handleRerun()}
            disabled={rerunning}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {rerunning ? '正在生成…' : '管理员手动生成 / 重跑'}
          </button>
          {rerunError ? <p className="text-sm text-red-700">{rerunError}</p> : null}
        </div>
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
            <button
              type="button"
              onClick={() => void handleRerun()}
              disabled={rerunning}
              className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {rerunning ? '重跑中…' : '管理员重跑月度结账'}
            </button>
            {rerunError ? <p className="mt-1 text-xs text-red-700">{rerunError}</p> : null}
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
                  {c.sampleBuyerKeys?.length ? (
                    <p className="mt-0.5 text-xs text-slate-400">
                      样本 buyerKey：{c.sampleBuyerKeys.join('、')}
                    </p>
                  ) : null}
                  {c.sampleOrderIds?.length ? (
                    <p className="mt-0.5 text-xs text-slate-400">
                      样本订单：{c.sampleOrderIds.join('、')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {risk ? (
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-semibold text-slate-900">小红书接口风险（最近 24 小时）</h3>
          <p className="mt-1 text-sm text-slate-600">{risk.note}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <MetricCard label="接口请求次数" value={formatCount(risk.requestCount24h)} />
            <MetricCard label="冷却跳过次数" value={formatCount(risk.throttledCount24h)} />
            <MetricCard
              label="失败次数"
              value={formatCount(risk.failedCount24h)}
              danger={risk.failedCount24h > 0}
            />
            <MetricCard
              label="熔断次数"
              value={formatCount(risk.circuitOpenCount24h)}
              danger={risk.circuitOpenCount24h > 0}
            />
          </div>

          {risk.highRiskApis.length > 0 ? (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-slate-700">高风险接口 / 触发点</h4>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {risk.highRiskApis.map((a) => (
                  <li key={a} className="font-mono">{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {risk.directRequestFindings && risk.directRequestFindings.length > 0 ? (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-slate-700">直连请求扫描</h4>
              <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-xs">
                {risk.directRequestFindings
                  .filter((f) => f.risk === 'high' || f.risk === 'medium')
                  .slice(0, 20)
                  .map((f) => (
                    <li key={`${f.file}:${f.line}`} className="rounded border border-slate-100 px-2 py-1">
                      <span className="font-mono text-slate-700">
                        [{f.risk}] {f.file}:{f.line}
                      </span>
                      <p className="text-slate-500">{f.reason}</p>
                      <p className="text-slate-400">{f.suggestion}</p>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function MetricCard(props: { label: string; value: string; danger?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${props.danger ? 'border-red-200 bg-red-50/40' : 'border-slate-100 bg-white'}`}
    >
      <p className="text-[11px] text-slate-500">{props.label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${props.danger ? 'text-red-800' : 'text-slate-900'}`}
      >
        {props.value}
      </p>
    </div>
  )
}
