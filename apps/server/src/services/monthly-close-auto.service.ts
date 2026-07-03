import { resolveMonthlyCloseMonth } from '../utils/monthly-close-month.util'
import { buildMonthlyCloseReconciliation } from './monthly-close-reconciliation.service'
import { runDataAccuracyAudit } from './data-accuracy-audit.service'
import { buildSyncRiskStatus } from './sync-request-audit.service'
import {
  acquireMonthlyCloseLock,
  appendMonthlyCloseRunLog,
  hasSuccessfulMonthlyCloseReport,
  readLatestMonthlyCloseReport,
  readMonthlyCloseReport,
  writeMonthlyCloseReport,
} from './monthly-close-report-store.service'
import type { MonthlyCloseAutoReport } from './monthly-close-auto.types'
import { logError, logInfo } from '../utils/server-log'
import { resolveReportBuildMeta } from '../utils/report-build-meta'

export type { MonthlyCloseAutoReport } from './monthly-close-auto.types'

function buildConclusionReasonSummary(
  report: Pick<MonthlyCloseAutoReport, 'blockingIssues' | 'syncRisk' | 'status'>,
): string {
  const parts: string[] = []
  if (report.blockingIssues?.length) {
    if (report.blockingIssues.some((b) => b.includes('经营总览和运营日报'))) {
      parts.push('金额差异')
    }
    if (report.blockingIssues.some((b) => b.includes('订单池') || b.includes('标准订单'))) {
      parts.push('订单差异')
    }
    if (report.blockingIssues.some((b) => b.includes('高风险售后客户'))) {
      parts.push('售后榜口径不一致')
    }
    if (report.blockingIssues.some((b) => b.includes('买家榜'))) {
      parts.push('买家榜口径不一致')
    }
    if (report.blockingIssues.some((b) => b.includes('重复订单'))) {
      parts.push('重复订单')
    }
    if (report.blockingIssues.some((b) => b.includes('支付时间'))) {
      parts.push('支付时间漏单风险')
    }
  }
  if (report.syncRisk.status === 'danger') parts.push('接口风险')
  if (parts.length === 0) {
    return report.status === 'pass' ? '数据核对通过' : '存在需关注的提示项'
  }
  return [...new Set(parts)].join('、')
}

export function resolveAutoCloseTargetMonth(now: Date = new Date()): string | null {
  const { year, month, day } = (() => {
    const key = now.toLocaleString('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    const [y, m, d] = key.split('-').map(Number)
    return { year: y!, month: m!, day: d! }
  })()
  if (day < 15) return null
  if (month === 1) return `${year - 1}-12`
  return `${year}-${String(month - 1).padStart(2, '0')}`
}

export async function runMonthlyCloseAuto(params?: {
  month?: string
  force?: boolean
  fullScan?: boolean
}): Promise<MonthlyCloseAutoReport> {
  const scope = resolveMonthlyCloseMonth({
    month: params?.month,
    autoPrevMonth: !params?.month,
  })
  const month = scope.month

  if (!params?.force && (await hasSuccessfulMonthlyCloseReport(month))) {
    const existing = await readMonthlyCloseReport(month)
    if (existing) return existing
  }

  const release = await acquireMonthlyCloseLock(month)
  const startedAt = new Date().toISOString()
  const fullScan = params?.fullScan !== false
  const buildMeta = resolveReportBuildMeta(fullScan)
  try {
    logInfo('月度结账', `开始自动核对 ${month}（${scope.startDate} ~ ${scope.endDate}）`)

    const [reconciliation, audit, syncRisk] = await Promise.all([
      buildMonthlyCloseReconciliation({ month, autoPrevMonth: !params?.month }),
      runDataAccuracyAudit({
        startDate: scope.startDate,
        endDate: scope.endDate,
        scope: 'monthly',
        fullScan,
      }),
      buildSyncRiskStatus(),
    ])

    const sectionB = reconciliation.sectionB as Record<string, unknown>
    const validRevenueCent = Math.round(Number(sectionB.validAmountYuan ?? 0) * 100)
    const checks = [...audit.checks]
    const blockingIssues = audit.blockingIssues ?? []
    const infoNotes = [...(audit.infoNotes ?? [])]

    for (const f of syncRisk.directRequestFindings ?? []) {
      if (f.risk === 'low' && f.reason.includes('本地数据库分页扫描')) {
        infoNotes.push(`本地数据库分页扫描（Prisma findMany）：${f.file}:${f.line}`)
      } else if (f.risk === 'medium' && f.reason.includes('setInterval')) {
        infoNotes.push(`setInterval 扫描提醒：${f.file}:${f.line}`)
      }
    }

    const blockers = [...new Set([...audit.blockers, ...reconciliation.dataQuality.blockers])]
    const warnings = [...new Set([...audit.warnings, ...reconciliation.dataQuality.warnings])]

    const moneyDiffCentTotal = audit.moneyDiffCentTotal
    const orderDiffTotal = audit.orderDiffTotal
    let status = audit.status
    if (reconciliation.dataQuality.level === 'danger') status = 'danger'
    if (moneyDiffCentTotal !== 0 || orderDiffTotal !== 0) status = 'danger'
    const runtimeSyncDanger =
      syncRisk.failedCount24h >= 20 ||
      syncRisk.circuitOpenCount24h > 0 ||
      (syncRisk.directRequestFindings ?? []).some((f) => f.risk === 'high')
    if (runtimeSyncDanger) status = 'danger'

    const canClose =
      status === 'pass' && blockers.length === 0 && blockingIssues.length === 0

    const report: MonthlyCloseAutoReport = {
      month,
      range: { startDate: scope.startDate, endDate: scope.endDate },
      generatedAt: new Date().toISOString(),
      status,
      canClose,
      score: Math.min(audit.score, reconciliation.dataQuality.score),
      schemaVersion: buildMeta.schemaVersion,
      appVersion: buildMeta.appVersion,
      gitCommit: buildMeta.gitCommit,
      fullScan: buildMeta.fullScan,
      blockingIssues,
      infoNotes: [...new Set(infoNotes)],
      summary: {
        validRevenueCent,
        paidOrderCount: Number(sectionB.paidOrderCount ?? 0),
        validOrderCount: Number(sectionB.validSoldOrderCount ?? 0),
        refundOrderCount: Number((reconciliation.sectionC as Record<string, unknown>).refundOrderCount ?? 0),
        qualityRefundOrderCount: Number(sectionB.qualityReturnCount ?? 0),
        unassignedOrderCount: Number(sectionB.unassignedOrderCount ?? 0),
        duplicateOrderCount: Number(sectionB.duplicateOrderCount ?? 0),
        moneyDiffCentTotal,
        orderDiffTotal,
      },
      blockers,
      warnings,
      checks,
      syncRisk: {
        status: syncRisk.status,
        requestCount24h: syncRisk.requestCount24h,
        throttledCount24h: syncRisk.throttledCount24h,
        failedCount24h: syncRisk.failedCount24h,
        circuitOpenCount24h: syncRisk.circuitOpenCount24h,
        highRiskApis: syncRisk.highRiskApis,
        directRequestFindings: syncRisk.directRequestFindings,
        note: syncRisk.note,
      },
      schedulerRegistered: (await import('./monthly-close-scheduler.service')).isMonthlyCloseSchedulerRegistered(),
    }

    report.conclusion = {
      canClose: report.canClose,
      reasonSummary: buildConclusionReasonSummary(report),
    }

    const reportPath = await writeMonthlyCloseReport(report)
    await appendMonthlyCloseRunLog({
      task: 'monthly-close-auto',
      month,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: report.status,
      reportPath,
    })
    logInfo('月度结账', `${month} 自动核对完成：${report.status}`)
    return report
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await appendMonthlyCloseRunLog({
      task: 'monthly-close-auto',
      month,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      errorMessage: message,
    })
    logError('月度结账', `自动核对失败：${message}`, err)
    throw err
  } finally {
    await release()
  }
}

export async function getMonthlyCloseStatus(): Promise<{
  latest: MonthlyCloseAutoReport | null
  targetMonth: string | null
  locked: boolean
  schedulerRegistered: boolean
}> {
  const { isMonthlyCloseLocked } = await import('./monthly-close-report-store.service')
  const { isMonthlyCloseSchedulerRegistered } = await import('./monthly-close-scheduler.service')
  const targetMonth = resolveAutoCloseTargetMonth()
  const latest = (await readLatestMonthlyCloseReport()) ?? (targetMonth ? await readMonthlyCloseReport(targetMonth) : null)
  return {
    latest,
    targetMonth,
    locked: await isMonthlyCloseLocked(),
    schedulerRegistered: isMonthlyCloseSchedulerRegistered(),
  }
}
