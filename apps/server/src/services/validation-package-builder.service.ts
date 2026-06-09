import archiver from 'archiver'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExportAnalysisBundle } from './analysis-pipeline.service'
import type { DashboardOverviewResponse } from './dashboard-api.service'
export interface SnapshotMeta {
  snapshotId: string
  refreshJobId: string
  preset: string
  startDate: string
  endDate: string
}
import type { FieldMappingResult } from '../types/analysis'
import type { FieldRecognitionCheck } from '../types/data-validation'
import type { OrderAttribution } from '../types/analysis'
import type { LatestDownloadFiles } from '../types/analysis'
import { generateBusinessReportExcel } from './report-excel.service'
import {
  buildAbnormalOrdersWorkbook,
  buildOrderAttributionWorkbook,
  buildSettlementMatchWorkbook,
  buildUnassignedOrdersWorkbook,
} from './validation-package-excel.service'
import { TRUST_STATUS_HINTS } from '../types/data-validation'

const SYSTEM_VERSION = process.env.npm_package_version ?? '0.2.0'

function isFullCalendarMonth(start: string, end: string): boolean {
  if (!start.endsWith('-01') || start.slice(0, 7) !== end.slice(0, 7)) return false
  const [y, m] = start.split('-').map(Number)
  const last = new Date(y!, m!, 0).getDate()
  return end === `${start.slice(0, 7)}-${String(last).padStart(2, '0')}`
}

export function buildValidationPackageFileName(startDate: string, endDate: string): string {
  if (isFullCalendarMonth(startDate, endDate)) {
    return `数据校验包_${startDate.slice(0, 7)}.zip`
  }
  return `数据校验包_${startDate}至${endDate}.zip`
}

function mappingToExport(m: FieldMappingResult) {
  return {
    fileName: m.fileName,
    fileType: m.fileType,
    mappings: m.mappings.map((e) => ({
      key: e.key,
      label: e.label,
      header: e.header,
      confidence: e.confidence,
      required: e.required,
    })),
    missingRequiredFields: m.missingRequiredFields,
    warnings: m.warnings,
  }
}

function buildFieldMappingJson(
  analyzeInput: ExportAnalysisBundle['analyzeInput'],
  fieldChecks: FieldRecognitionCheck[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    order: mappingToExport(analyzeInput.order.mapping),
    fieldChecks,
  }
  if (analyzeInput.live) out.live = mappingToExport(analyzeInput.live.mapping)
  if (analyzeInput.pending) out.pendingSettlement = mappingToExport(analyzeInput.pending.mapping)
  if (analyzeInput.settled) out.settledSettlement = mappingToExport(analyzeInput.settled.mapping)
  return out
}

function buildNormalizedOrdersJson(
  bundle: ExportAnalysisBundle,
  attributions: Map<number, OrderAttribution>,
): unknown[] {
  return bundle.context.orderDedupe.uniqueOrders.map((o) => {
    const attr = attributions.get(o.sourceRowIndex)
    const view = bundle.context.views.find((v) => v.orderId === o.orderId)
    return {
      orderId: o.orderId,
      orderTime: o.orderTime?.toISOString() ?? null,
      orderTimeText: o.orderTimeText,
      buyerId: o.buyerId,
      gmvCent: o.gmvCent,
      orderStatusText: o.orderStatusText,
      afterSaleStatusText: o.afterSaleStatusText,
      reasonText: o.reasonText,
      isSigned: o.isSigned,
      isReturned: o.isReturned,
      isQualityReturn: view?.isQualityReturn ?? false,
      actualSigned: o.actualSigned,
      actualSignedAmountCent: o.actualSignedAmountCent,
      anchorName: attr?.anchorName ?? view?.anchorName ?? '未归属',
      attributionType: attr?.attributionType ?? view?.attributionType ?? 'unassigned',
      matchedLiveSessionId: attr?.matchedLiveSessionId ?? null,
      matchedRuleName: attr?.matchedRuleName ?? null,
      errors: o.errors,
    }
  })
}

function buildReadme(
  dashboard: DashboardOverviewResponse & SnapshotMeta,
  trustStatus: string,
): string {
  return [
    '直播订单经营分析 — 数据校验包',
    '================================',
    '',
    `分析时间范围：${dashboard.startDate} 至 ${dashboard.endDate}`,
    `展示标签：${dashboard.periodLabel}`,
    `快照 ID：${dashboard.snapshotId}`,
    `刷新任务 ID：${dashboard.refreshJobId}`,
    `数据可信状态：${dashboard.trust.statusLabel}（${trustStatus}）`,
    `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `系统版本：${SYSTEM_VERSION}`,
    '',
    '目录说明：',
    '  raw/          — 最近一次用于分析的原始 Excel',
    '  result/       — 系统分析结果、快照、校验与字段映射 JSON',
    '  detail/       — 订单归属、结算匹配、异常/未归属明细',
    '  report/       — 系统导出的详细经营报表 Excel',
    '',
    '口径说明（摘要）：',
    '  GMV：去重订单成交金额；退款金额单独统计，不从支付金额扣减；',
    '  主播归属：优先直播场次/字段，其次时段规则；',
    (TRUST_STATUS_HINTS as Record<string, string>)[trustStatus] ?? '',
    '',
    '安全说明：',
    '  本包不含 Cookie、密钥、.env、用户密码等敏感信息。',
    '  订单号、买家 ID、金额保留用于第三方复算校验。',
  ].join('\n')
}

async function addRawFiles(
  archive: archiver.Archiver,
  files: LatestDownloadFiles,
): Promise<void> {
  const specs: Array<{
    key: keyof LatestDownloadFiles
    zipName: string
    missingName: string
    required?: boolean
  }> = [
    { key: 'order', zipName: 'raw/order.xlsx', missingName: 'missing_order.txt', required: true },
    { key: 'live', zipName: 'raw/live.xlsx', missingName: 'raw/missing_live.txt' },
    {
      key: 'pendingSettlement',
      zipName: 'raw/pendingSettlement.xlsx',
      missingName: 'raw/missing_pendingSettlement.txt',
    },
    {
      key: 'settledSettlement',
      zipName: 'raw/settledSettlement.xlsx',
      missingName: 'raw/missing_settledSettlement.txt',
    },
  ]

  for (const spec of specs) {
    const entry = files[spec.key]
    if (entry?.filePath && fs.existsSync(entry.filePath)) {
      archive.file(entry.filePath, { name: spec.zipName })
    } else if (spec.required) {
      throw new Error('订单表文件缺失，无法生成校验包')
    } else {
      const msg = `未找到${spec.key}对应的成功下载文件，分析时该表按缺失处理。`
      archive.append(msg, { name: spec.missingName })
    }
  }
}

export async function buildValidationPackageZip(
  outputPath: string,
  dashboard: DashboardOverviewResponse & SnapshotMeta,
  bundle: ExportAnalysisBundle,
): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpkg-'))
  const reportPath = path.join(tmpDir, 'exported-report.xlsx')

  try {
    await generateBusinessReportExcel(reportPath, dashboard, bundle)

    const trustChecks = {
      trustStatus: bundle.trustStatus,
      trust: dashboard.trust,
      validation: bundle.validation,
      snapshotTrustChecks: null,
    }

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(outputPath)
      const archive = archiver('zip', { zlib: { level: 6 } })

      output.on('close', () => resolve())
      archive.on('error', (err) => reject(err))
      archive.pipe(output)

      void (async () => {
        try {
          await addRawFiles(archive, bundle.files)

          archive.append(JSON.stringify(bundle.result, null, 2), {
            name: 'result/analysis-result.json',
          })
          archive.append(JSON.stringify({ note: '快照已移除，请使用 live-query 导出' }, null, 2), {
            name: 'result/snapshot.json',
          })
          archive.append(JSON.stringify(trustChecks, null, 2), {
            name: 'result/trust-checks.json',
          })
          archive.append(
            JSON.stringify(
              buildFieldMappingJson(bundle.analyzeInput, bundle.fieldChecks),
              null,
              2,
            ),
            { name: 'result/field-mapping.json' },
          )

          archive.append(
            JSON.stringify(
              buildNormalizedOrdersJson(bundle, bundle.attributions),
              null,
              2,
            ),
            { name: 'detail/normalized-orders.json' },
          )

          const attrBuf = await buildOrderAttributionWorkbook(bundle, bundle.attributions)
          archive.append(attrBuf, { name: 'detail/order-attribution.xlsx' })

          const settleBuf = await buildSettlementMatchWorkbook(bundle)
          archive.append(settleBuf, { name: 'detail/settlement-match.xlsx' })

          const abnormalBuf = await buildAbnormalOrdersWorkbook(bundle)
          archive.append(abnormalBuf, { name: 'detail/abnormal-orders.xlsx' })

          const unassignedBuf = await buildUnassignedOrdersWorkbook(bundle)
          archive.append(unassignedBuf, { name: 'detail/unassigned-orders.xlsx' })

          archive.file(reportPath, { name: 'report/exported-report.xlsx' })

          archive.append(buildReadme(dashboard, bundle.trustStatus), { name: 'README.txt' })

          await archive.finalize()
        } catch (e) {
          reject(e)
        }
      })()
    })
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
