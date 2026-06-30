/**
 * 核算导出验收
 * 用法: npm run verify:anchor-export
 */
import ExcelJS from 'exceljs'
import {
  buildAnchorAuditExcelBuffer,
  buildAnchorAuditExportPayload,
  getEarliestOrderDateKey,
} from '../src/services/anchor-audit-export.service'
import { buildAnchorPocketSummary } from '../src/services/anchor-pocket-revenue.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function run(): Promise<void> {
  const issues: string[] = []
  const today = formatDateKeyShanghai(new Date())
  const earliest = await getEarliestOrderDateKey()
  assert(earliest != null || true, '数据库可能无订单（本地空库可忽略）', issues)

  const startDate = earliest ?? today
  const payload = await buildAnchorAuditExportPayload({ startDate, endDate: today })
  assert(Boolean(payload.range), 'JSON 应含 range', issues)
  assert(Array.isArray(payload.summaryByAnchor), 'JSON 应含 summaryByAnchor', issues)
  assert(Array.isArray(payload.normalizedOrders), 'JSON 应含 normalizedOrders', issues)
  assert(Array.isArray(payload.afterSales), 'JSON 应含 afterSales', issues)
  assert(Array.isArray(payload.schedules), 'JSON 应含 schedules', issues)
  assert(Array.isArray(payload.warnings), 'JSON 应含 warnings', issues)

  if (payload.normalizedOrders.length > 0) {
    const sample = payload.normalizedOrders[0] as Record<string, unknown>
    assert('anchorName' in sample, '订单明细应有匹配主播', issues)
    assert('attributionSource' in sample, '订单明细应有匹配来源', issues)
    assert('attributionExplain' in sample, '订单明细应有匹配说明', issues)
    assert('scheduleConfirmed' in sample, '订单明细应有 scheduleConfirmed', issues)
  }

  const { buffer } = await buildAnchorAuditExcelBuffer({ startDate, endDate: today })
  assert(buffer.length > 1000, 'Excel 文件应非空', issues)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const names = wb.worksheets.map((s) => s.name)
  for (const sheet of ['主播汇总', '订单明细', '售后明细', '排班明细', '异常待确认']) {
    assert(names.includes(sheet), `Excel 应含 Sheet「${sheet}」`, issues)
  }

  const pocket = await buildAnchorPocketSummary({ startDate, endDate: today })
  if (payload.summaryByAnchor.length && pocket.anchors.length) {
    const exportTotal = payload.summaryByAnchor.reduce(
      (s, r) => s + Number((r as { actualPocketAmount: number }).actualPocketAmount ?? 0),
      0,
    )
    const pocketTotal = pocket.anchors.reduce((s, r) => s + r.actualPocketAmount, 0)
    assert(
      Math.abs(exportTotal - pocketTotal) < 0.02,
      `导出汇总实际到账 ${exportTotal} 应与 API ${pocketTotal} 一致`,
      issues,
    )
  }

  if (issues.length) {
    console.error('verify:anchor-export FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:anchor-export OK')
}

void run()
