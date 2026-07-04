import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { useAuth } from '../../providers/AuthProvider'

const CURRENT_SCHEMA_VERSION = 2

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

interface DailyRevenueDiffRow {
  date: string
  boardCent: number
  dailyCent: number
  diffCent: number
  boardOrders: number
  dailyOrders: number
  diffOrders: number
}

interface OrderPoolDiffRow {
  orderNo: string
  buyerNickname: string
  payAmountCent: number
  validRevenueCent: number
  orderStatus: string
  afterSaleStatus: string
  reason: string
}

interface BuyerDrawerDiffRow {
  buyerDisplayName: string
  buyerKey: string
  sampleOrderIds: string[]
  diffFields: Array<{ field: string; listValue: string; drawerValue: string }>
  possibleReasons: string[]
}

interface QualityRefundDiagnostic {
  officialRawCount: number
  matchedOrderCount: number
  unmatchedOrderCount: number
  periodQualityRefundOrderCount: number
  excludeSamples: Array<{ orderNo: string; packageId: string; reason: string }>
}

interface DataAccuracyCheck {
  key: string
  title: string
  status: string
  category?: string
  note: string
  diffCent?: number
  diffCount?: number
  dailyDiffs?: DailyRevenueDiffRow[]
  orderPoolDiffs?: {
    onlyInBoard?: OrderPoolDiffRow[]
    onlyInAggregate?: OrderPoolDiffRow[]
    roundingNote?: string
    widePoolExcludedSamples?: OrderPoolDiffRow[]
  }
  buyerDrawerDiffs?: BuyerDrawerDiffRow[]
  badBuyerDrawerDiffs?: BuyerDrawerDiffRow[]
  qualityRefundDiagnostic?: QualityRefundDiagnostic
}

interface MonthlyCloseReport {
  month: string
  range: { startDate: string; endDate: string }
  generatedAt: string
  status: 'pass' | 'warning' | 'danger'
  canClose: boolean
  score: number
  schemaVersion?: number
  appVersion?: string
  gitCommit?: string
  fullScan?: boolean
  conclusion?: { canClose: boolean; reasonSummary: string }
  blockingIssues?: string[]
  infoNotes?: string[]
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
  checks: DataAccuracyCheck[]
  syncRisk: SyncRiskStatus
  schedulerRegistered?: boolean
}

function isInfoCheck(c: DataAccuracyCheck): boolean {
  return c.category === 'info' || c.category === 'technical' || c.category === 'ignorable' ||
    c.key === 'raw_full_db_info' || c.key === 'raw_vs_normalized'
}

function isBlockingCheck(c: DataAccuracyCheck): boolean {
  return !isInfoCheck(c) && c.status === 'danger'
}

function formatCent(cent: number): string {
  return `¥${(cent / 100).toFixed(2)}`
}

export const DataHealthPage: React.FC = () => {
  const { formatMoney, formatCount } = useAmountDisplay()
  const { user } = useAuth()
  const canRerunMonthlyClose = user?.role === 'super_admin'
  const [report, setReport] = useState<MonthlyCloseReport | null>(null)
  const [syncRisk, setSyncRisk] = useState<SyncRiskStatus | null>(null)
  const [schedulerRegistered, setSchedulerRegistered] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)
  const [techOpen, setTechOpen] = useState(false)
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null)

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
    if (!canRerunMonthlyClose) {
      setRerunError('仅管理员可手动重跑月度结账，请联系管理员处理')
      return
    }
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
      const msg = e instanceof Error ? e.message : '重跑失败'
      setRerunError(
        /维护|403|404|未启用|权限/.test(msg)
          ? '仅管理员可手动重跑月度结账，请联系管理员处理'
          : msg,
      )
    } finally {
      setRerunning(false)
    }
  }

  const risk = syncRisk ?? report?.syncRisk
  const qualityCheck = report?.checks.find((c) => c.key === 'quality_refund_diagnostic')
  const qualityDiag = qualityCheck?.qualityRefundDiagnostic
  const qualityNeedsAttention =
    qualityCheck != null && (qualityCheck.status === 'warning' || qualityCheck.status === 'danger')
  const isStaleReport = report != null && (report.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION
  const isPartialScan = report?.fullScan === false
  const blockingIssues =
    report?.blockingIssues?.length
      ? report.blockingIssues
      : (report?.checks.filter(isBlockingCheck).map((c) => `${c.title}：${c.note}`) ?? [])
  const infoNotes =
    report?.infoNotes?.length
      ? report.infoNotes.filter(
          (n) => !n.startsWith('品退订单数诊断') && !n.startsWith('品退'),
        )
      : (report?.checks
          .filter((c) => isInfoCheck(c) && c.key !== 'quality_refund_diagnostic')
          .map((c) => `${c.title}：${c.note}`) ?? [])

  const techChecks = report?.checks.filter(isInfoCheck) ?? []
  const blockingChecks = report?.checks.filter((c) => !isInfoCheck(c)) ?? []

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
            {!canRerunMonthlyClose ? ' 如需手动重跑，请联系管理员。' : null}
          </p>
          {canRerunMonthlyClose ? (
            <button
              type="button"
              onClick={() => void handleRerun()}
              disabled={rerunning}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {rerunning ? '正在生成…' : '管理员手动生成 / 重跑'}
            </button>
          ) : null}
          {rerunError ? <p className="text-sm text-red-700">{rerunError}</p> : null}
        </div>
      ) : (
        <>
          {isStaleReport ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              当前报告由旧版本生成（schema={report.schemaVersion ?? '—'}），建议管理员重跑以获取最新核对逻辑与差异明细。
            </div>
          ) : null}

          {isPartialScan ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              当前报告为非全量核对（fullScan=false），高风险售后客户榜等可能为抽样结果；建议管理员重跑 fullScan 报告。
            </div>
          ) : null}

          {qualityNeedsAttention && qualityCheck ? (
            <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-950">品退诊断异常</h3>
              <p className="mt-1 text-sm text-amber-900">{qualityCheck.note}</p>
              {qualityDiag ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <MetricCard
                    label="官方品退原始数"
                    value={formatCount(qualityDiag.officialRawCount)}
                  />
                  <MetricCard
                    label="本期匹配数"
                    value={formatCount(qualityDiag.matchedOrderCount)}
                  />
                  <MetricCard
                    label="未匹配数"
                    value={formatCount(qualityDiag.unmatchedOrderCount)}
                  />
                  <MetricCard
                    label="本期计入品退数"
                    value={formatCount(qualityDiag.periodQualityRefundOrderCount)}
                    danger={
                      (qualityDiag.officialRawCount > 0 ||
                        qualityDiag.matchedOrderCount > 0) &&
                      qualityDiag.periodQualityRefundOrderCount === 0
                    }
                  />
                </div>
              ) : null}
              {qualityDiag &&
              (qualityDiag.officialRawCount > 0 || qualityDiag.matchedOrderCount > 0) &&
              qualityDiag.periodQualityRefundOrderCount === 0 ? (
                <p className="mt-2 text-sm font-medium text-amber-950">
                  本期存在官方品退或已匹配记录，但经营总览品退订单数仍为 0，请对照下方未计入原因排查。
                </p>
              ) : null}
              {qualityDiag?.excludeSamples?.length ? (
                <div className="mt-3 overflow-x-auto">
                  <p className="mb-1 text-xs font-medium text-amber-950">未计入原因样本</p>
                  <table className="w-full text-left text-[11px] text-amber-900">
                    <thead>
                      <tr className="text-amber-700">
                        <th className="pr-2">订单号</th>
                        <th className="pr-2">包裹号</th>
                        <th>原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qualityDiag.excludeSamples.map((s) => (
                        <tr key={`${s.orderNo}-${s.reason}`} className="border-t border-amber-200/60">
                          <td className="py-1 pr-2 font-mono">{s.orderNo}</td>
                          <td className="py-1 pr-2 font-mono">{s.packageId}</td>
                          <td className="py-1">{s.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ) : qualityCheck && qualityDiag ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">品退诊断</h3>
              <p className="mt-1 text-xs text-slate-600">{qualityCheck.note}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <MetricCard label="官方品退原始数" value={formatCount(qualityDiag.officialRawCount)} />
                <MetricCard label="本期匹配数" value={formatCount(qualityDiag.matchedOrderCount)} />
                <MetricCard label="未匹配数" value={formatCount(qualityDiag.unmatchedOrderCount)} />
                <MetricCard
                  label="本期计入品退数"
                  value={formatCount(qualityDiag.periodQualityRefundOrderCount)}
                />
              </div>
            </section>
          ) : null}

          {/* 第一块：结论 */}
          <section
            className={`rounded-2xl border p-4 ${
              report.canClose
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            <h3 className="text-base font-semibold">结论</h3>
            <p className="mt-2 text-lg font-semibold">
              本月结账状态：{report.canClose ? '可以' : '不可以'}
            </p>
            <p className="mt-1 text-sm">
              原因：{report.conclusion?.reasonSummary ?? (report.canClose ? '数据核对通过' : '存在需处理差异')}
            </p>
            <p className="mt-2 text-xs text-slate-600">
              结账月份：{report.month}（{report.range.startDate} ~ {report.range.endDate}）
            </p>
            <p className="text-xs text-slate-600">
              报告生成时间：{new Date(report.generatedAt).toLocaleString('zh-CN')}
            </p>
            <p className="text-xs text-slate-600">
              版本：{report.appVersion ?? '—'} / {report.gitCommit?.slice(0, 8) ?? '—'}
              {report.fullScan != null ? ` / fullScan=${report.fullScan ? 'true' : 'false'}` : ''}
            </p>
            {canRerunMonthlyClose ? (
              <button
                type="button"
                onClick={() => void handleRerun()}
                disabled={rerunning}
                className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {rerunning ? '重跑中…' : '管理员重跑月度结账'}
              </button>
            ) : null}
            {rerunError ? <p className="mt-1 text-xs text-red-700">{rerunError}</p> : null}
          </section>

          {/* 第二块：真正要处理的问题 */}
          <section className="rounded-xl border border-red-200 bg-red-50/60 p-4">
            <h3 className="text-sm font-semibold text-red-900">真正要处理的问题</h3>
            {blockingIssues.length > 0 ? (
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-red-800">
                {blockingIssues.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-emerald-800">暂无阻塞结账的问题。</p>
            )}

            {blockingChecks
              .filter((c) => c.status === 'danger')
              .map((c) => (
                <div key={c.key} className="mt-3 rounded-lg border border-red-100 bg-white p-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left text-sm font-medium text-slate-900"
                    onClick={() => setExpandedCheck(expandedCheck === c.key ? null : c.key)}
                  >
                    <span>{c.title}</span>
                    <span className="text-xs text-slate-500">
                      {expandedCheck === c.key ? '收起' : '查看差异明细'}
                    </span>
                  </button>
                  {expandedCheck === c.key ? (
                    <div className="mt-2 space-y-2 text-xs text-slate-700">
                      <p>{c.note}</p>
                      {c.dailyDiffs?.map((d) => (
                        <div key={d.date} className="rounded border border-slate-100 p-2">
                          <p className="font-medium">{d.date}</p>
                          <p>
                            经营总览 {formatCent(d.boardCent)}｜运营日报 {formatCent(d.dailyCent)}｜差额{' '}
                            {d.diffCent} 分
                          </p>
                          <p>
                            订单数：经营总览 {d.boardOrders}｜运营日报 {d.dailyOrders}｜差 {d.diffOrders}
                          </p>
                        </div>
                      ))}
                      {c.orderPoolDiffs?.roundingNote ? (
                        <p className="text-amber-800">{c.orderPoolDiffs.roundingNote}</p>
                      ) : null}
                      {c.orderPoolDiffs?.onlyInBoard?.length ? (
                        <DiffOrderTable title="只在经营总览有效成交池" rows={c.orderPoolDiffs.onlyInBoard} />
                      ) : null}
                      {c.orderPoolDiffs?.onlyInAggregate?.length ? (
                        <DiffOrderTable
                          title="只在标准订单发货池"
                          rows={c.orderPoolDiffs.onlyInAggregate}
                        />
                      ) : null}
                      {(c.badBuyerDrawerDiffs ?? c.buyerDrawerDiffs)?.map((b) => (
                        <BuyerDiffCard key={b.buyerKey} row={b} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
          </section>

          {/* 第三块：提示信息 */}
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">提示信息</h3>
            {infoNotes.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {infoNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">暂无额外提示。</p>
            )}
          </section>

          {/* 关键指标（简版） */}
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">关键指标</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <MetricCard label="有效成交金额" value={formatMoney(report.summary.validRevenueCent / 100)} />
              <MetricCard label="有效订单数" value={formatCount(report.summary.validOrderCount)} />
              <MetricCard label="退款订单数" value={formatCount(report.summary.refundOrderCount)} />
              <MetricCard label="品退订单数" value={formatCount(report.summary.qualityRefundOrderCount)} />
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
          </section>

          {/* 技术明细（默认折叠） */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-700"
              onClick={() => setTechOpen(!techOpen)}
            >
              技术明细
              <span className="text-xs font-normal text-slate-500">{techOpen ? '收起' : '展开'}</span>
            </button>
            {techOpen ? (
              <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-2">
                <ul className="space-y-2">
                  {techChecks.map((c) => (
                    <li key={c.key} className="rounded-lg border border-slate-100 px-3 py-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-800">{c.title}</span>
                      <p className="mt-0.5">{c.note}</p>
                    </li>
                  ))}
                </ul>

                {blockingChecks
                  .filter((c) => c.status !== 'danger')
                  .map((c) => (
                    <li
                      key={c.key}
                      className="list-none rounded-lg border border-slate-100 px-3 py-2 text-xs text-slate-600"
                    >
                      <span className="font-medium text-slate-800">{c.title}</span>
                      <p className="mt-0.5">{c.note}</p>
                    </li>
                  ))}

                {risk ? (
                  <div className="rounded-lg border border-slate-100 p-3 text-xs">
                    <p className="font-semibold text-slate-800">接口扫描与 24 小时统计</p>
                    <p className="mt-1 text-slate-600">{risk.note}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <MetricCard label="接口请求次数" value={formatCount(risk.requestCount24h)} />
                      <MetricCard label="冷却跳过" value={formatCount(risk.throttledCount24h)} />
                    </div>
                    {risk.directRequestFindings?.length ? (
                      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                        {risk.directRequestFindings.slice(0, 30).map((f) => (
                          <li key={`${f.file}:${f.line}`} className="rounded border border-slate-50 px-2 py-1">
                            <span className="font-mono text-slate-700">
                              [{f.risk}] {f.file}:{f.line}
                            </span>
                            <p className="text-slate-500">{f.reason}</p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  )
}

function DiffOrderTable(props: { title: string; rows: OrderPoolDiffRow[] }) {
  const { formatMoney } = useAmountDisplay()
  return (
    <div>
      <p className="mb-1 font-medium text-slate-800">{props.title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-slate-500">
              <th className="pr-2">订单号</th>
              <th className="pr-2">买家</th>
              <th className="pr-2">支付金额</th>
              <th className="pr-2">有效成交</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.orderNo} className="border-t border-slate-50">
                <td className="py-1 pr-2 font-mono">{r.orderNo}</td>
                <td className="py-1 pr-2">{r.buyerNickname}</td>
                <td className="py-1 pr-2">{formatMoney(r.payAmountCent / 100)}</td>
                <td className="py-1 pr-2">{formatMoney(r.validRevenueCent / 100)}</td>
                <td className="py-1">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BuyerDiffCard(props: { row: BuyerDrawerDiffRow }) {
  const { row } = props
  return (
    <div className="rounded border border-slate-100 p-2">
      <p className="font-medium text-slate-900">
        {row.buyerDisplayName}
        <span className="ml-2 font-normal text-slate-500">({row.buyerKey})</span>
      </p>
      {row.sampleOrderIds.length > 0 ? (
        <p className="text-slate-500">订单样本：{row.sampleOrderIds.join('、')}</p>
      ) : null}
      <p className="mt-1 font-medium text-slate-700">差异字段：</p>
      <ul className="list-disc pl-4">
        {row.diffFields.map((f) => (
          <li key={f.field}>
            {f.field}：榜单 {f.listValue}，明细 {f.drawerValue}
          </li>
        ))}
      </ul>
      {row.possibleReasons.length > 0 ? (
        <>
          <p className="mt-1 font-medium text-slate-700">可能原因：</p>
          <ul className="list-disc pl-4 text-slate-600">
            {row.possibleReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
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
