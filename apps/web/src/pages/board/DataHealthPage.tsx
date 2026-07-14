import React, { useCallback, useEffect, useState } from 'react'
import { ApiError, apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { useAuth } from '../../providers/AuthProvider'
import { formatDataHealthWarning, resolvePendingRefundTypeCount } from '../../lib/data-health-warning'

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

interface RollingDataHealthCloseReport {
  generatedAt: string
  triggeredBy: string
  startDate: string
  endDate: string
  dataRangeLabel: string
  gmvAmountYuan: number
  actualSignedAmountYuan: number
  paidOrderCount: number
  signedOrderCount: number
  signRate: number | null
  refundAmountYuan: number
  refundOrderCount: number
  refundRate: number | null
  qualityRefundOrderCount: number
  qualityRefundRate: number | null
  afterSaleRelatedOrderCount: number
  afterSaleCacheRecordCount: number
  unassignedOrderCount: number
  duplicateOrderCount: number
  returnRefundOrderCount?: number
  refundOnlyOrderCount?: number
  unknownRefundTypeOrderCount?: number
  classifiedRefundOrderCount?: number
  returnRefundTypeIncomplete?: boolean
  warnings: string[]
}

interface RollingCloseStatus {
  registered: boolean
  dailyTime: string
  timezone: string
  latest: RollingDataHealthCloseReport | null
  running: boolean
  lastRunStatus: 'pass' | 'failed' | null
  lastError: string | null
  lastFinishedAt: string | null
}

interface LuckyGiftHealthReport {
  configuredShopCount: number
  configuredShops: string[]
  missingShops: string[]
  lastSuccessShopCount: number
  drawCount: number
  winnerCount: number
  noAddressCount: number
  incompleteAddressCount: number
  pendingCount: number
  shippedCount: number
  detailFailCount: number
  duplicateWinnerCount: number
  bigintAnomalyCount: number
  listMismatchCount: number
  incompleteFieldCount: number
  overdueNoAddressCount: number
  localOfficialConflictCount: number
  misclassifiedNoAddressCount: number
  blockers: string[]
  warnings: string[]
  statusSumOk: boolean
}

function formatTriggeredBy(source: string | null | undefined): string {
  switch (String(source ?? '').trim()) {
    case 'manual-api':
      return '管理员手动核对'
    case 'startup-catchup':
      return '启动后自动补跑'
    case 'rolling-health-scheduler':
      return '每日自动核对'
    default:
      return source?.trim() || '—'
  }
}

function mapRollingCloseError(err: unknown): string {
  if (!(err instanceof Error)) return '执行失败，请稍后重试'
  if (err instanceof ApiError) {
    if (err.status === 401) return '登录已失效，请重新登录'
    if (err.status === 403) return '当前账号没有执行权限'
    if (err.status === 404) return err.message || '接口或功能不存在'
    if (err.status === 409) return err.message || '已有核对任务正在运行，请稍后'
    if (err.status === 0) return '网络连接失败，请稍后重试'
    if (err.status >= 500) return err.message || '执行失败，请查看具体原因'
    return err.message || `请求失败（HTTP ${err.status}）`
  }
  const msg = err.message.trim()
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return '网络连接失败，请稍后重试'
  }
  return msg || '执行失败，请稍后重试'
}

function formatRateValue(
  rate: number | null | undefined,
  formatRate: (n: number) => string,
): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return formatRate(rate)
}

interface AnchorAttributionHealthReport {
  generatedAt: string
  startDate: string
  endDate: string
  attributionAlgorithmVersion?: string
  scheduleConflictCount: number
  templateDeviationCount?: number
  templateDeviationWithoutConfirmCount?: number
  unassignedOrderCount: number
  crossShopAbnormalAttributionCount: number
  leaderboardCardDetailMismatchCount: number
  qualityCardDetailMismatchCount: number
  qualityCrossAnchorDupCount?: number
  qualityAnchorMismatchCount?: number
  shopTotalMismatchCount?: number
  issues: Array<{ date?: string; orderNo?: string; reason: string }>
  passed: boolean
  message: string
}

function apiRequestWithTimeout<T>(
  path: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  return apiRequest<T>(path, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timer)
  })
}

export const DataHealthPage: React.FC = () => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()
  const { user } = useAuth()
  const canRunRollingClose = user?.role === 'super_admin'

  const [status, setStatus] = useState<RollingCloseStatus | null>(null)
  const [syncRisk, setSyncRisk] = useState<SyncRiskStatus | null>(null)
  const [attributionHealth, setAttributionHealth] = useState<AnchorAttributionHealthReport | null>(
    null,
  )
  const [luckyGiftHealth, setLuckyGiftHealth] = useState<LuckyGiftHealthReport | null>(null)
  const [closeLoading, setCloseLoading] = useState(true)
  const [extrasLoading, setExtrasLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [techOpen, setTechOpen] = useState(false)

  const loadCloseStatus = useCallback(async () => {
    setCloseLoading(true)
    setError(null)
    try {
      const closeStatus = await apiRequest<RollingCloseStatus>(
        '/api/board/data-health/rolling-close/status',
      )
      setStatus(closeStatus)
    } catch (e) {
      setError(mapRollingCloseError(e))
      setStatus(null)
    } finally {
      setCloseLoading(false)
    }
  }, [])

  const loadSupplementary = useCallback(async () => {
    setExtrasLoading(true)
    try {
      const [risk, attr, lucky] = await Promise.all([
        apiRequestWithTimeout<SyncRiskStatus>('/api/board/sync-risk/status', 12_000).catch(
          () => null,
        ),
        apiRequestWithTimeout<AnchorAttributionHealthReport>(
          '/api/board/data-health/anchor-attribution',
          20_000,
        ).catch(() => null),
        apiRequestWithTimeout<LuckyGiftHealthReport>('/api/board/lucky-gifts/health', 12_000).catch(
          () => null,
        ),
      ])
      setSyncRisk(risk)
      setAttributionHealth(attr)
      setLuckyGiftHealth(lucky)
    } finally {
      setExtrasLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    await Promise.all([loadCloseStatus(), loadSupplementary()])
  }, [loadCloseStatus, loadSupplementary])

  useEffect(() => {
    void loadCloseStatus()
    void loadSupplementary()
  }, [loadCloseStatus, loadSupplementary])

  const handleRun = async () => {
    if (!canRunRollingClose || running) return
    setRunning(true)
    setRunError(null)
    try {
      await apiRequest<{ ok: boolean; report: RollingDataHealthCloseReport }>(
        '/api/board/data-health/rolling-close/run',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      )
      await load()
    } catch (e) {
      setRunError(mapRollingCloseError(e))
    } finally {
      setRunning(false)
    }
  }

  const report = status?.latest ?? null
  const isBusy = running || Boolean(status?.running)

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-1 sm:px-0">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">数据健康 / 滚动30天结账</h2>
        <p className="mt-1 text-sm text-slate-500">
          每天 03:10 自动核对已经稳定下来的滚动30天数据。统计范围会延迟15天，避免刚签收、刚退款的订单反复变化。
        </p>
      </div>

      {attributionHealth ? (
        <section
          className={`rounded-xl border p-4 text-sm ${
            attributionHealth.passed
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`}
        >
          <h3 className="text-sm font-semibold">{attributionHealth.message}</h3>
          <p className="mt-1 text-xs opacity-80">
            检查范围 {attributionHealth.startDate} ~ {attributionHealth.endDate}
            {attributionHealth.attributionAlgorithmVersion
              ? ` · ${attributionHealth.attributionAlgorithmVersion}`
              : ''}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <p>排班冲突数：{formatCount(attributionHealth.scheduleConflictCount)}</p>
            <p>
              模板偏离且无确认：
              {formatCount(
                attributionHealth.templateDeviationWithoutConfirmCount ??
                  attributionHealth.templateDeviationCount ??
                  0,
              )}
            </p>
            <p>归属异常订单数：{formatCount(attributionHealth.unassignedOrderCount)}</p>
            <p>跨直播号异常归属数：{formatCount(attributionHealth.crossShopAbnormalAttributionCount)}</p>
            <p>
              品退跨主播重复数：
              {formatCount(attributionHealth.qualityCrossAnchorDupCount ?? 0)}
            </p>
            <p>
              品退主播与订单主播不一致：
              {formatCount(attributionHealth.qualityAnchorMismatchCount ?? 0)}
            </p>
            <p>
              品退卡片与明细不一致数：
              {formatCount(attributionHealth.qualityCardDetailMismatchCount)}
            </p>
            <p>
              主播合计与全店差异：
              {formatCount(attributionHealth.shopTotalMismatchCount ?? 0)}
            </p>
          </div>
          <p className="mt-3 text-xs opacity-90">
            品退接口用于确认哪些订单发生品退。主播归属以订单下单时所在直播场次为准，支付、签收、退款和品退统一归到该订单主播。合法且已确认的临时调班不计入异常。
          </p>
          {!attributionHealth.passed && attributionHealth.issues.length > 0 ? (
            <ul className="mt-3 max-h-48 list-disc space-y-1 overflow-auto pl-5 text-xs">
              {attributionHealth.issues.slice(0, 30).map((issue, idx) => (
                <li key={`${issue.date ?? ''}-${issue.orderNo ?? ''}-${idx}`}>
                  {issue.date ? `${issue.date} · ` : ''}
                  {issue.orderNo ? `${issue.orderNo} · ` : ''}
                  {issue.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {luckyGiftHealth ? (
        <section
          className={`rounded-xl border p-4 text-sm ${
            luckyGiftHealth.blockers.length === 0
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`}
        >
          <h3 className="text-sm font-semibold">福袋发货数据健康</h3>
          <p className="mt-1 text-xs opacity-80">
            已配置 {luckyGiftHealth.configuredShopCount} 店
            {luckyGiftHealth.missingShops.length > 0
              ? ` · 未配置：${luckyGiftHealth.missingShops.join('、')}`
              : ''}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <p>福袋活动数：{formatCount(luckyGiftHealth.drawCount)}</p>
            <p>中奖人数：{formatCount(luckyGiftHealth.winnerCount)}</p>
            <p>未填地址：{formatCount(luckyGiftHealth.noAddressCount)}</p>
            <p>地址不完整：{formatCount(luckyGiftHealth.incompleteAddressCount)}</p>
            <p>待发货：{formatCount(luckyGiftHealth.pendingCount)}</p>
            <p>已发货：{formatCount(luckyGiftHealth.shippedCount)}</p>
            <p>详情读取失败：{formatCount(luckyGiftHealth.detailFailCount)}</p>
            <p>重复中奖：{formatCount(luckyGiftHealth.duplicateWinnerCount)}</p>
          </div>
          {luckyGiftHealth.blockers.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
              {luckyGiftHealth.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {luckyGiftHealth.warnings.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs opacity-90">
              {luckyGiftHealth.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <h3 className="text-sm font-semibold text-slate-900">自动核对安排</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <p>
            自动核对：
            {closeLoading
              ? '读取中…'
              : status == null
                ? '—'
                : status.registered
                  ? '已开启'
                  : '未开启'}
          </p>
          <p>执行时间：每日 {status?.dailyTime ?? '03:10'}</p>
          <p>时区：{status?.timezone ?? 'Asia/Shanghai'}</p>
          <p>
            最近执行结果：
            {status?.lastRunStatus === 'pass'
              ? '成功'
              : status?.lastRunStatus === 'failed'
                ? '失败'
                : '—'}
          </p>
          <p>
            最近生成时间：
            {report?.generatedAt
              ? new Date(report.generatedAt).toLocaleString('zh-CN')
              : status?.lastFinishedAt
                ? new Date(status.lastFinishedAt).toLocaleString('zh-CN')
                : '—'}
          </p>
          <p>最近核对范围：{report?.dataRangeLabel ?? '—'}</p>
        </div>
        {status?.lastError ? (
          <p className="mt-2 text-sm text-amber-800">最近失败原因：{status.lastError}</p>
        ) : null}
        {status?.registered === false ? (
          <p className="mt-2 text-sm text-amber-800">
            自动核对尚未注册。服务重启后会重新开启；也可由管理员手动生成一份报告。
          </p>
        ) : null}
        {extrasLoading ? (
          <p className="mt-2 text-xs text-slate-400">
            归属与福袋健康检查在后台加载，不影响滚动30天核对结果。
          </p>
        ) : null}
      </section>

      {closeLoading ? (
        <p className="text-sm text-slate-500">正在加载滚动30天核对状态…</p>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : !report ? (
        <div className="space-y-3">
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-600">
            暂时还没有滚动30天核对报告。系统启动后会自动补跑，也可以由管理员立即生成。
          </p>
          {canRunRollingClose ? (
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={isBusy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isBusy ? '正在核对…' : '立即生成第一份报告'}
            </button>
          ) : null}
          {runError ? <p className="text-sm text-red-700">{runError}</p> : null}
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
            <h3 className="text-base font-semibold">最新核对结果</h3>
            <p className="mt-2 text-sm">核对范围：{report.dataRangeLabel}</p>
            <p className="mt-1 text-sm">
              生成时间：{new Date(report.generatedAt).toLocaleString('zh-CN')}
            </p>
            <p className="mt-1 text-sm">触发来源：{formatTriggeredBy(report.triggeredBy)}</p>
            {canRunRollingClose ? (
              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={isBusy}
                className="mt-3 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100/60 disabled:opacity-50"
              >
                {isBusy ? '正在核对…' : '立即重新核对滚动30天'}
              </button>
            ) : null}
            {runError ? <p className="mt-2 text-sm text-red-700">{runError}</p> : null}
          </section>

          {report.warnings.length > 0 ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-950">需要留意</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {report.warnings.map((w) => (
                  <li key={w}>{formatDataHealthWarning(w)}</li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              本次核对没有额外警告。
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">经营核对数字</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <MetricCard label="支付金额" value={formatMoney(report.gmvAmountYuan)} />
              <MetricCard label="已签收金额" value={formatMoney(report.actualSignedAmountYuan)} />
              <MetricCard label="支付订单数" value={formatCount(report.paidOrderCount)} />
              <MetricCard label="已签收订单数" value={formatCount(report.signedOrderCount)} />
              <MetricCard
                label="签收率"
                value={formatRateValue(report.signRate, formatRate)}
              />
              <MetricCard label="退款金额" value={formatMoney(report.refundAmountYuan)} />
              <MetricCard label="退款订单数" value={formatCount(report.refundOrderCount)} />
              <MetricCard
                label="退货退款单数"
                value={formatCount(report.returnRefundOrderCount ?? 0)}
              />
              <MetricCard
                label="仅退款单数"
                value={formatCount(report.refundOnlyOrderCount ?? 0)}
              />
              <MetricCard
                label="退款类型待确认"
                value={formatCount(resolvePendingRefundTypeCount(report))}
                danger={resolvePendingRefundTypeCount(report) > 0}
              />
              <MetricCard
                label="退款率"
                value={formatRateValue(report.refundRate, formatRate)}
              />
              <MetricCard
                label="品退订单数"
                value={formatCount(report.qualityRefundOrderCount)}
              />
              <MetricCard
                label="品退率"
                value={formatRateValue(report.qualityRefundRate, formatRate)}
              />
              <MetricCard
                label="售后相关订单数"
                value={formatCount(report.afterSaleRelatedOrderCount)}
              />
              <MetricCard
                label="售后缓存记录数"
                value={formatCount(report.afterSaleCacheRecordCount)}
              />
              <MetricCard
                label="归属异常订单数"
                value={formatCount(report.unassignedOrderCount)}
                danger={report.unassignedOrderCount > 0}
              />
              <MetricCard
                label="重复订单风险数"
                value={formatCount(report.duplicateOrderCount)}
                danger={report.duplicateOrderCount > 0}
              />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-700"
              onClick={() => setTechOpen(!techOpen)}
            >
              同步风险（技术参考）
              <span className="text-xs font-normal text-slate-500">{techOpen ? '收起' : '展开'}</span>
            </button>
            {techOpen && syncRisk ? (
              <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-2 text-xs text-slate-600">
                <p>{syncRisk.note}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <MetricCard label="近24小时请求次数" value={formatCount(syncRisk.requestCount24h)} />
                  <MetricCard label="冷却跳过" value={formatCount(syncRisk.throttledCount24h)} />
                  <MetricCard label="失败次数" value={formatCount(syncRisk.failedCount24h)} />
                  <MetricCard
                    label="熔断次数"
                    value={formatCount(syncRisk.circuitOpenCount24h)}
                  />
                </div>
              </div>
            ) : null}
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
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${props.danger ? 'text-red-800' : 'text-slate-900'}`}
      >
        {props.value}
      </p>
    </div>
  )
}
