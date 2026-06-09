import type { BusinessAnalysisResult } from '../business-analysis.service'
import type { AnalysisTrustStatus, DataValidationReport } from '../../types/data-validation'
import { API_COLLECTION_TYPE_LABELS } from '../../types/data-validation'

export type ValidationCheckStatus = '通过' | '警告' | '失败' | '缺失'

export interface SyncValidationCheckItem {
  label: string
  status: ValidationCheckStatus
  detail: string | null
}

export interface SyncValidationSummary {
  outcome: 'success' | 'success_empty' | 'preview_only' | 'failed'
  trustStatus: AnalysisTrustStatus | 'empty'
  message: string
  apiCollection: Array<{ label: string; status: ValidationCheckStatus; count: number }>
  normalization: {
    orderCount: number
    abnormalOrderCount: number
    liveSessionCount: number
    pendingCount: number
    settledCount: number
  }
  checks: SyncValidationCheckItem[]
  previewReasons: string[]
  failedStage: string | null
  failedReason: string | null
  suggestion: string | null
}

function checkStatus(ok: boolean | undefined, warn?: boolean): ValidationCheckStatus {
  if (ok === true) return '通过'
  if (warn) return '警告'
  if (ok === false) return '失败'
  return '缺失'
}

export function buildSyncValidationSummary(params: {
  trustStatus: AnalysisTrustStatus
  validation: DataValidationReport
  apiCounts: { order: number; live: number; pending: number; settled: number }
  result?: BusinessAnalysisResult | null
}): SyncValidationSummary {
  const { trustStatus, validation, apiCounts, result } = params
  const v = validation

  const apiCollection = [
    {
      label: API_COLLECTION_TYPE_LABELS.order,
      status: (apiCounts.order > 0 ? '通过' : '缺失') as ValidationCheckStatus,
      count: apiCounts.order,
    },
    {
      label: API_COLLECTION_TYPE_LABELS.live,
      status: (apiCounts.live > 0 ? '通过' : '缺失') as ValidationCheckStatus,
      count: apiCounts.live,
    },
    {
      label: API_COLLECTION_TYPE_LABELS.pendingSettlement,
      status: (apiCounts.pending > 0 ? '通过' : '缺失') as ValidationCheckStatus,
      count: apiCounts.pending,
    },
    {
      label: API_COLLECTION_TYPE_LABELS.settledSettlement,
      status: (apiCounts.settled > 0 ? '通过' : '缺失') as ValidationCheckStatus,
      count: apiCounts.settled,
    },
  ]

  const dateBlocked = v.fileDateRanges.some((f) => f.status === 'blocked')
  const dateWarning = v.fileDateRanges.some((f) => f.status === 'warning')
  const amountWarnings = v.warnings.filter(
    (w) => w.includes('单位') || w.includes('100 倍') || w.includes('金额'),
  )
  const amountBlocked = v.errors.some(
    (e) => e.includes('单位') || e.includes('100 倍') || e.includes('毛利润大于 GMV'),
  )
  const settlementWarnings = v.settlementReconciliation?.warnings.length ?? 0
  const unassigned = result?.unassignedOrders.length ?? v.orderAttribution?.unassignedOrderCount ?? 0
  const orderTotal = result?.overview.orderCount ?? v.orderAttribution?.uniqueOrderCount ?? 0
  const unassignedRatio = orderTotal > 0 ? unassigned / orderTotal : 0

  const grossWarn =
    result &&
    result.overview.gmvCent > 0 &&
    result.overview.grossProfitCent > result.overview.gmvCent * 2

  const checks: SyncValidationCheckItem[] = [
    {
      label: '日期范围校验',
      status: dateBlocked ? '失败' : dateWarning ? '警告' : '通过',
      detail: v.fileDateRanges.find((f) => f.message)?.message ?? null,
    },
    {
      label: '金额单位诊断',
      status: amountBlocked ? '失败' : amountWarnings.length > 0 ? '警告' : '通过',
      detail: amountWarnings[0] ?? null,
    },
    {
      label: '订单对账',
      status: checkStatus(v.orderAttribution?.ok),
      detail: v.orderAttribution?.message ?? null,
    },
    {
      label: 'GMV 对账',
      status: checkStatus(v.gmvReconciliation?.ok),
      detail: v.gmvReconciliation?.message ?? null,
    },
    {
      label: '主播归属',
      status: unassignedRatio > 0.3 ? '警告' : '通过',
      detail: unassigned > 0 ? `未归属订单 ${unassigned} 单` : null,
    },
    {
      label: '结算匹配',
      status: settlementWarnings > 0 ? '警告' : '通过',
      detail: v.settlementReconciliation?.warnings[0] ?? null,
    },
    {
      label: '毛利润异常',
      status: grossWarn ? '警告' : '通过',
      detail: grossWarn ? '毛利润相对 GMV 偏高，请核对平台扣费字段' : null,
    },
  ]

  const previewReasons: string[] = []
  if (apiCounts.live === 0) previewReasons.push('直播场次接口无数据，主播归属可能不准')
  if (apiCounts.pending === 0) previewReasons.push('待结算接口无数据，待结算金额可能不完整')
  if (apiCounts.settled === 0) previewReasons.push('已结算接口无数据，已结算金额可能不完整')
  for (const w of v.completeness.warnings) {
    if (!previewReasons.includes(w)) previewReasons.push(w)
  }
  for (const w of amountWarnings) {
    if (!previewReasons.includes(w)) previewReasons.push(w)
  }
  if (v.settlementReconciliation?.warnings.length) {
    previewReasons.push(...v.settlementReconciliation.warnings.slice(0, 3))
  }
  if (result?.overview.grossProfitNote && result.overview.grossProfitNote.includes('偏高')) {
    previewReasons.push('平台扣费字段未识别，毛利润可能偏高')
  }

  let outcome: SyncValidationSummary['outcome'] = 'success'
  if (trustStatus === 'blocked' || trustStatus === 'error') outcome = 'failed'
  else if (trustStatus === 'preview_only') outcome = 'preview_only'

  const failedChecks = checks.filter((c) => c.status === '失败')
  let failedReason: string | null = null
  let failedStage: string | null = null
  let suggestion: string | null = null

  if (outcome === 'failed') {
    failedStage = '数据校验'
    failedReason =
      failedChecks.map((c) => `${c.label}：${c.detail ?? c.status}`).join('；') ||
      v.errors[0] ||
      '数据校验未通过'
    if (amountBlocked || amountWarnings.some((w) => w.includes('100 倍'))) {
      suggestion = '请查看系统设置 → 数据诊断 → 金额单位诊断'
    } else if (v.orderAttribution && !v.orderAttribution.ok) {
      suggestion = '请查看订单归属与异常订单明细'
    } else {
      suggestion = '请查看数据诊断摘要'
    }
  }

  const message =
    outcome === 'preview_only'
      ? '同步完成，但数据仅供预览'
      : outcome === 'failed'
        ? failedReason ?? '同步失败'
        : '同步完成'

  return {
    outcome,
    trustStatus,
    message,
    apiCollection,
    normalization: {
      orderCount: result?.overview.orderCount ?? v.orderAttribution?.uniqueOrderCount ?? 0,
      abnormalOrderCount: result?.abnormalOrders.length ?? v.orderAttribution?.abnormalOrderCount ?? 0,
      liveSessionCount: apiCounts.live,
      pendingCount: apiCounts.pending,
      settledCount: apiCounts.settled,
    },
    checks,
    previewReasons: [...new Set(previewReasons)].slice(0, 8),
    failedStage,
    failedReason,
    suggestion,
  }
}

export function buildEmptyRangeSummary(
  presetLabel: string,
  apiCounts: { order: number; live: number; pending: number; settled: number },
): SyncValidationSummary {
  return {
    outcome: 'success_empty',
    trustStatus: 'empty',
    message: `当前范围暂无订单数据（${presetLabel}）`,
    apiCollection: [
      { label: API_COLLECTION_TYPE_LABELS.order, status: '缺失', count: apiCounts.order },
      { label: API_COLLECTION_TYPE_LABELS.live, status: apiCounts.live > 0 ? '通过' : '缺失', count: apiCounts.live },
      {
        label: API_COLLECTION_TYPE_LABELS.pendingSettlement,
        status: apiCounts.pending > 0 ? '通过' : '缺失',
        count: apiCounts.pending,
      },
      {
        label: API_COLLECTION_TYPE_LABELS.settledSettlement,
        status: apiCounts.settled > 0 ? '通过' : '缺失',
        count: apiCounts.settled,
      },
    ],
    normalization: {
      orderCount: 0,
      abnormalOrderCount: 0,
      liveSessionCount: apiCounts.live,
      pendingCount: apiCounts.pending,
      settledCount: apiCounts.settled,
    },
    checks: [],
    previewReasons: [],
    failedStage: null,
    failedReason: null,
    suggestion: null,
  }
}

export function formatSyncFailureMessage(summary: SyncValidationSummary): string {
  if (summary.failedReason) return summary.failedReason
  const failed = summary.checks.filter((c) => c.status === '失败')
  if (failed.length > 0) {
    return failed.map((c) => `${c.label}未通过${c.detail ? `：${c.detail}` : ''}`).join('；')
  }
  return '数据校验未通过，无法生成看板'
}
