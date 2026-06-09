import type { BusinessAnalysisResult, LatestDownloadFiles } from '../types/analysis'
import { resolveLatestDownloadedFiles } from './downloaded-file-resolver.service'
import type {
  AnalysisContext,
  AnalysisTrustStatus,
  DataValidationReport,
  FieldRecognitionCheck,
} from '../types/data-validation'
import { TRUST_STATUS_HINTS } from '../types/data-validation'
import { parseExcelFile } from './excel.service'
import { buildFieldMapping, formatOrderFieldError } from './field-mapper.service'
import {
  runBusinessAnalysis,
  prepareAnalysisArtifacts,
  type AnalyzeInput,
} from './business-analysis.service'
import { attributeOrders } from './order-attribution.service'
import { getAnchorConfigSync } from './anchor.service'
import { dedupeOrders } from './order-deduper.service'
import { normalizeLiveSessions } from './live-session.service'
import { normalizeOrders } from './order-normalizer.service'
import type { OrderAttribution } from '../types/analysis'
import type { DateRangeResolved } from '../utils/date-range'
import { defaultThisMonthRange } from '../utils/date-range'
import { downloadAllEnabled } from './download.service'
import {
  checkFieldRecognition,
  extractLiveFileDateRange,
  extractOrderFileDateRange,
  extractPendingFileDateRange,
  extractSettledFileDateRange,
  runFullDataValidation,
  resolveTrustStatus,
  buildShortRiskHints,
} from './data-validation.service'
import { normalizeSettlementRecords } from './settlement-normalizer.service'
import { writeOperationLog } from './audit.service'
import { findUserById } from './user.service'
import type { AuditAction } from '../types/audit'

let lastSelectedRange: DateRangeResolved = defaultThisMonthRange()

export function getLastSelectedRange(): DateRangeResolved {
  return lastSelectedRange
}

export interface AnalysisPipelineResult {
  result: BusinessAnalysisResult | null
  validation: DataValidationReport
  trustStatus: AnalysisTrustStatus
  selectedRange: DateRangeResolved
}

export async function getLatestSuccessFiles(): Promise<LatestDownloadFiles> {
  const { files } = await resolveLatestDownloadedFiles()
  return files
}

interface ParsedInputs {
  analyzeInput: AnalyzeInput
  fieldChecks: FieldRecognitionCheck[]
  files: LatestDownloadFiles
  parseErrors: string[]
}

async function parseDownloadFiles(
  files: LatestDownloadFiles,
  range: DateRangeResolved,
  fileWarnings: string[] = [],
): Promise<ParsedInputs> {
  const warnings: string[] = [...fileWarnings]
  const parseErrors: string[] = []
  const fieldChecks: FieldRecognitionCheck[] = []

  if (!files.order) {
    throw new Error('请先在系统设置下载订单表')
  }

  let orderParsed
  try {
    orderParsed = parseExcelFile(files.order.filePath)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Excel 文件解析失败，请重新下载')
  }

  const orderMapping = buildFieldMapping('order', files.order.fileName, orderParsed.headers)
  const orderFieldErr = formatOrderFieldError(orderMapping)
  fieldChecks.push({
    type: 'order',
    typeLabel: '订单表',
    missingRequired: orderMapping.missingRequiredFields,
    warnings: orderMapping.warnings,
    ok: !orderFieldErr,
  })
  if (orderFieldErr) {
    parseErrors.push(orderFieldErr)
  }

  let liveInput: AnalyzeInput['live']
  if (files.live) {
    try {
      const parsed = parseExcelFile(files.live.filePath)
      const mapping = buildFieldMapping('live', files.live.fileName, parsed.headers)
      liveInput = { parsed, mapping }
      fieldChecks.push({
        type: 'live',
        typeLabel: '直播场次',
        missingRequired: mapping.missingRequiredFields,
        warnings: mapping.warnings,
        ok: true,
      })
    } catch {
      warnings.push('直播场次表解析失败，将使用时间规则归属主播')
      fieldChecks.push({
        type: 'live',
        typeLabel: '直播场次',
        missingRequired: [],
        warnings: ['解析失败'],
        ok: false,
      })
    }
  } else if (!warnings.some((w) => w.includes('直播场次'))) {
    warnings.push('未找到直播场次表，将使用默认时间规则归属主播')
    fieldChecks.push({
      type: 'live',
      typeLabel: '直播场次',
      missingRequired: [],
      warnings: ['未下载'],
      ok: false,
    })
  }

  let pendingInput: AnalyzeInput['pending']
  let hasPendingFile = false
  if (files.pendingSettlement) {
    try {
      const parsed = parseExcelFile(files.pendingSettlement.filePath)
      const mapping = buildFieldMapping(
        'pendingSettlement',
        files.pendingSettlement.fileName,
        parsed.headers,
      )
      if (mapping.missingRequiredFields.length === 0) {
        pendingInput = { parsed, mapping }
        hasPendingFile = true
      } else {
        warnings.push('待结算明细字段不完整，待结算金额按 0 处理')
      }
      fieldChecks.push({
        type: 'pendingSettlement',
        typeLabel: '待结算明细',
        missingRequired: mapping.missingRequiredFields,
        warnings: mapping.warnings,
        ok: mapping.missingRequiredFields.length === 0,
      })
    } catch {
      warnings.push('待结算明细解析失败，待结算金额按 0 处理')
      fieldChecks.push({
        type: 'pendingSettlement',
        typeLabel: '待结算明细',
        missingRequired: [],
        warnings: ['解析失败'],
        ok: false,
      })
    }
  } else if (!warnings.some((w) => w.includes('待结算'))) {
    warnings.push('未导入待结算明细，待结算金额显示为 0')
    fieldChecks.push({
      type: 'pendingSettlement',
      typeLabel: '待结算明细',
      missingRequired: [],
      warnings: ['未下载'],
      ok: false,
    })
  }

  let settledInput: AnalyzeInput['settled']
  let hasSettledFile = false
  if (files.settledSettlement) {
    try {
      const parsed = parseExcelFile(files.settledSettlement.filePath)
      const mapping = buildFieldMapping(
        'settledSettlement',
        files.settledSettlement.fileName,
        parsed.headers,
      )
      if (mapping.missingRequiredFields.length === 0) {
        settledInput = { parsed, mapping }
        hasSettledFile = true
      } else {
        warnings.push('已结算明细字段不完整，已结算金额按 0 处理')
      }
      fieldChecks.push({
        type: 'settledSettlement',
        typeLabel: '已结算明细',
        missingRequired: mapping.missingRequiredFields,
        warnings: mapping.warnings,
        ok: mapping.missingRequiredFields.length === 0,
      })
    } catch {
      warnings.push('已结算明细解析失败，已结算金额按 0 处理')
      fieldChecks.push({
        type: 'settledSettlement',
        typeLabel: '已结算明细',
        missingRequired: [],
        warnings: ['解析失败'],
        ok: false,
      })
    }
  } else if (!warnings.some((w) => w.includes('已结算'))) {
    warnings.push('未导入已结算明细，已结算金额显示为 0')
    fieldChecks.push({
      type: 'settledSettlement',
      typeLabel: '已结算明细',
      missingRequired: [],
      warnings: ['未下载'],
      ok: false,
    })
  }

  void range

  return {
    analyzeInput: {
      order: { parsed: orderParsed, mapping: orderMapping },
      live: liveInput,
      pending: pendingInput,
      settled: settledInput,
      hasPendingFile,
      hasSettledFile,
      warnings,
    },
    fieldChecks,
    files,
    parseErrors,
  }
}

function buildAnalysisContext(
  parsed: ParsedInputs,
  range: DateRangeResolved,
): AnalysisContext {
  const artifacts = prepareAnalysisArtifacts(parsed.analyzeInput)
  const ordersById = new Map(
    artifacts.dedupe.uniqueOrders.map((o) => [o.orderId, o]),
  )

  let pendingFileRange = null
  if (parsed.analyzeInput.pending) {
    const pendingRecords = normalizeSettlementRecords(
      parsed.analyzeInput.pending.parsed,
      parsed.analyzeInput.pending.mapping,
      'pending',
    )
    pendingFileRange = extractPendingFileDateRange(pendingRecords, ordersById)
  }

  let settledFileRange = null
  if (parsed.analyzeInput.settled) {
    const settledRecords = normalizeSettlementRecords(
      parsed.analyzeInput.settled.parsed,
      parsed.analyzeInput.settled.mapping,
      'settled',
    )
    settledFileRange = extractSettledFileDateRange(settledRecords)
  }

  return {
    files: parsed.files,
    selectedRange: range,
    orderMapping: parsed.analyzeInput.order.mapping,
    orderDedupe: artifacts.dedupe,
    views: artifacts.views,
    settlement: artifacts.settlement,
    hasPendingFile: parsed.analyzeInput.hasPendingFile,
    hasSettledFile: parsed.analyzeInput.hasSettledFile,
    liveSessionCount: artifacts.liveSessions.length,
    liveRange: extractLiveFileDateRange(artifacts.liveSessions),
    orderFileRange: extractOrderFileDateRange(artifacts.dedupe.uniqueOrders),
    pendingFileRange,
    settledFileRange,
    parseWarnings: parsed.analyzeInput.warnings,
    parseErrors: parsed.parseErrors,
  }
}

async function logValidationOutcome(
  userId: string | undefined,
  trustStatus: AnalysisTrustStatus,
  validation: DataValidationReport,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<void> {
  if (!userId) return
  const user = await findUserById(userId)
  const meta = {
    dateRange: validation.selectedRange,
    trustStatus,
    warnings: validation.warnings.slice(0, 20),
    errors: validation.errors.slice(0, 20),
    fileNames: validation.completeness.tables
      .map((t) => t.fileName)
      .filter(Boolean),
    abnormalCounts: {
      abnormalOrders: validation.orderAttribution?.abnormalOrderCount ?? 0,
      unassigned: validation.orderAttribution?.unassignedOrderCount ?? 0,
    },
  }

  const base = {
    userId,
    username: user?.username ?? null,
    role: user?.role ?? null,
    module: 'dashboard' as const,
    requestId: audit?.requestId ?? null,
    ip: audit?.ip ?? null,
    userAgent: audit?.userAgent ?? null,
    meta,
  }

  await writeOperationLog({
    ...base,
    action: 'data_validation_start',
    description: '开始数据校验',
  })

  if (trustStatus === 'official_ready') {
    await writeOperationLog({
      ...base,
      action: 'analysis_official_ready',
      description: '数据校验通过，可正式汇报',
    })
    await writeOperationLog({
      ...base,
      action: 'data_validation_success',
      description: '数据校验成功',
    })
  } else if (trustStatus === 'preview_only') {
    await writeOperationLog({
      ...base,
      action: 'analysis_preview_only',
      description: '数据仅可预览，不建议正式汇报',
    })
    await writeOperationLog({
      ...base,
      action: 'data_validation_warning',
      description: `数据校验警告：${validation.warnings[0] ?? TRUST_STATUS_HINTS.preview_only}`,
    })
  } else if (trustStatus === 'blocked') {
    await writeOperationLog({
      ...base,
      action: 'analysis_blocked',
      description: '数据异常，禁止正式汇报',
    })
    await writeOperationLog({
      ...base,
      action: 'data_validation_failed',
      description: `数据校验失败：${validation.errors[0] ?? '未知'}`,
    })
  } else {
    await writeOperationLog({
      ...base,
      action: 'data_validation_failed',
      description: `分析异常：${validation.errors[0] ?? '未知'}`,
    })
  }
}

async function logPipelineStep(
  audit: { userId?: string; requestId?: string; ip?: string; userAgent?: string } | undefined,
  action: AuditAction,
  description: string,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!audit?.userId) return
  const user = await findUserById(audit.userId)
  await writeOperationLog({
    userId: audit.userId,
    username: user?.username ?? null,
    role: user?.role ?? null,
    action,
    module: 'dashboard',
    description,
    requestId: audit.requestId ?? null,
    ip: audit.ip ?? null,
    userAgent: audit.userAgent ?? null,
    meta,
  })
}

export async function runAnalysisPipeline(
  range: DateRangeResolved = lastSelectedRange,
  audit?: { userId?: string; requestId?: string; ip?: string; userAgent?: string },
): Promise<AnalysisPipelineResult> {
  lastSelectedRange = range

  let validation: DataValidationReport
  let trustStatus: AnalysisTrustStatus = 'error'
  let result: BusinessAnalysisResult | null = null
  let resolvedFiles: LatestDownloadFiles = {}

  await logPipelineStep(audit, 'analysis_pipeline_start', '开始经营分析流水线', {
    startDate: range.startDate,
    endDate: range.endDate,
  })

  try {
    const resolved = await resolveLatestDownloadedFiles()
    resolvedFiles = resolved.files
    await logPipelineStep(audit, 'excel_parse_success', '已定位最近成功下载文件', {
      fileNames: Object.values(resolved.files).map((f) => f.fileName),
    })

    const parsed = await parseDownloadFiles(resolved.files, range, resolved.warnings)
    const orderRows = parsed.analyzeInput.order.parsed.rowCount
    await logPipelineStep(audit, 'order_normalize_success', '订单表解析完成', {
      rowCount: orderRows,
    })
    await logPipelineStep(audit, 'order_dedup_success', '订单去重与归属准备完成', {})

    const ctx = buildAnalysisContext(parsed, range)
    validation = await runFullDataValidation(ctx, parsed.fieldChecks)
    validation.errors.push(...parsed.parseErrors)

    if (!parsed.fieldChecks.find((f) => f.type === 'order')?.ok) {
      const fieldErr =
        parsed.parseErrors[0] ?? '订单表缺少关键字段，无法进行分析'
      validation.errors.push(fieldErr)
      await logPipelineStep(audit, 'field_mapping_failed', fieldErr, {
        missing: parsed.fieldChecks.find((f) => f.type === 'order')?.missingRequired,
      })
    }

    await logPipelineStep(audit, 'order_attribution_success', '主播归属完成', {
      orderCount: ctx.views.length,
    })
    await logPipelineStep(audit, 'settlement_reconcile_success', '结算匹配完成', {})

    trustStatus = resolveTrustStatus(validation)

    if (trustStatus !== 'blocked' && trustStatus !== 'error') {
      result = runBusinessAnalysis(parsed.analyzeInput)
      result.overview.lastUpdatedAt = new Date().toISOString()
      if (trustStatus === 'preview_only') {
        result.overview.warnings.unshift(TRUST_STATUS_HINTS.preview_only)
      }
      await logPipelineStep(audit, 'business_analysis_success', '经营分析完成', {
        trustStatus,
        orderCount: result.overview.orderCount,
        gmvCent: result.overview.gmvCent,
        abnormalCount: result.abnormalOrders.length,
      })
      await logPipelineStep(audit, 'analysis_pipeline_success', '分析流水线成功', {
        trustStatus,
      })
    } else {
      await logPipelineStep(audit, 'analysis_pipeline_failed', '分析未通过可信校验', {
        trustStatus,
        errors: validation.errors.slice(0, 5),
      })
    }
  } catch (err) {
    const completeness = await import('./data-validation.service').then((m) =>
      m.checkDownloadCompleteness(),
    )
    validation = {
      selectedRange: { startDate: range.startDate, endDate: range.endDate },
      completeness,
      fileDateRanges: [],
      fieldRecognition: [],
      orderAttribution: null,
      gmvReconciliation: null,
      settlementReconciliation: null,
      warnings: [],
      errors: [err instanceof Error ? err.message : '分析失败'],
      abnormalReasons: [],
    }
    trustStatus = err instanceof Error && err.message.includes('订单表') ? 'blocked' : 'error'
    const msg = err instanceof Error ? err.message : '分析失败'
    await logPipelineStep(audit, 'excel_parse_failed', msg, {
      fileNames: Object.values(resolvedFiles).map((f) => f?.fileName),
    })
    await logPipelineStep(audit, 'analysis_pipeline_failed', msg, { trustStatus })
  }

  await logValidationOutcome(audit?.userId, trustStatus, validation!, audit)

  return {
    result,
    validation: validation!,
    trustStatus,
    selectedRange: range,
  }
}

export async function runAnalysisFromLatestDownloads(
  range?: DateRangeResolved,
  audit?: { userId?: string; requestId?: string; ip?: string; userAgent?: string },
): Promise<AnalysisPipelineResult> {
  return runAnalysisPipelineFromRawOrExcel(range ?? lastSelectedRange, audit)
}

/** 优先使用 API 同步的 JSON 原始数据，无数据时回退最近 Excel 下载 */
export async function runAnalysisPipelineFromRawOrExcel(
  range: DateRangeResolved = lastSelectedRange,
  audit?: { userId?: string; requestId?: string; ip?: string; userAgent?: string },
): Promise<AnalysisPipelineResult> {
  lastSelectedRange = range

  const { runAnalysisPipelineFromXhsRaw } = await import(
    './xhs-api-sync/xhs-analysis-from-raw.service'
  )
  const rawPipeline = await runAnalysisPipelineFromXhsRaw(range, audit)

  if (rawPipeline) {
    return rawPipeline
  }

  return runAnalysisPipeline(range, audit)
}

export interface ExportAnalysisBundle {
  context: AnalysisContext
  validation: DataValidationReport
  trustStatus: AnalysisTrustStatus
  result: BusinessAnalysisResult
  files: LatestDownloadFiles
  analyzeInput: AnalyzeInput
  fieldChecks: FieldRecognitionCheck[]
  attributions: Map<number, OrderAttribution>
}

function buildAttributionsForOrders(input: AnalyzeInput): Map<number, OrderAttribution> {
  const anchorConfig = getAnchorConfigSync()
  const normalized = normalizeOrders(input.order.parsed, input.order.mapping)
  const dedupe = dedupeOrders(normalized)
  const liveNorm = input.live
    ? normalizeLiveSessions(input.live.parsed, input.live.mapping, anchorConfig)
    : { sessions: [], warnings: [] }
  return attributeOrders(dedupe.uniqueOrders, liveNorm.sessions, anchorConfig)
}

/** 导出报表/校验包时重新解析下载文件，生成明细级数据 */
export async function runExportAnalysisBundle(
  range: DateRangeResolved,
): Promise<ExportAnalysisBundle> {
  const resolved = await resolveLatestDownloadedFiles()
  const parsed = await parseDownloadFiles(resolved.files, range, resolved.warnings)
  const ctx = buildAnalysisContext(parsed, range)
  const validation = await runFullDataValidation(ctx, parsed.fieldChecks)
  validation.errors.push(...parsed.parseErrors)
  const trustStatus = resolveTrustStatus(validation)
  const result = runBusinessAnalysis(parsed.analyzeInput)
  const attributions = buildAttributionsForOrders(parsed.analyzeInput)
  return {
    context: ctx,
    validation,
    trustStatus,
    result,
    files: parsed.files,
    analyzeInput: parsed.analyzeInput,
    fieldChecks: parsed.fieldChecks,
    attributions,
  }
}

export async function refreshWithDownload(
  userId: string,
  range: DateRangeResolved = defaultThisMonthRange(),
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<AnalysisPipelineResult> {
  lastSelectedRange = range
  try {
    await downloadAllEnabled(userId, range, audit)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '下载失败'
    if (msg.includes('Cookie') || msg.includes('Excel')) {
      throw err
    }
    throw new Error(`下载失败：${msg}`)
  }

  return runAnalysisPipeline(range, { ...audit, userId })
}
