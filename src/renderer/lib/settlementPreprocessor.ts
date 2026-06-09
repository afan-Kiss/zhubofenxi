import type { FieldMappingResult } from '../types/fieldMapping'
import type { ImportedExcelFile } from '../types/import'
import type { SettlementPreprocessResult, SettlementRecord } from '../types/settlement'
import { sumCent } from './money'
import { normalizeSettlementRecords } from './settlementNormalizer'

function splitValidAndAbnormal(records: SettlementRecord[]) {
  const valid: SettlementRecord[] = []
  const abnormal: SettlementRecord[] = []
  for (const record of records) {
    if (record.errors.length > 0) {
      abnormal.push(record)
    } else {
      valid.push(record)
    }
  }
  return { valid, abnormal }
}

function sumByDirection(records: SettlementRecord[], direction: SettlementRecord['direction']) {
  return sumCent(records.filter((r) => r.direction === direction).map((r) => r.amountCent))
}

export function canPreprocessSettlement(
  pendingFile: ImportedExcelFile | undefined,
  pendingMapping: FieldMappingResult | null,
  settledFile: ImportedExcelFile | undefined,
  settledMapping: FieldMappingResult | null,
): { ok: boolean; reason?: string } {
  const hasPending = Boolean(pendingFile && pendingMapping)
  const hasSettled = Boolean(settledFile && settledMapping)
  if (!hasPending && !hasSettled) {
    return { ok: false, reason: '未导入待结算或已结算明细' }
  }

  if (hasPending && pendingMapping && pendingMapping.missingRequiredFields.length > 0) {
    return { ok: false, reason: '待结算明细缺少关键字段，无法预处理' }
  }
  if (hasSettled && settledMapping && settledMapping.missingRequiredFields.length > 0) {
    return { ok: false, reason: '已结算明细缺少关键字段，无法预处理' }
  }
  return { ok: true }
}

export function preprocessSettlement(
  pendingFile: ImportedExcelFile | undefined,
  pendingMapping: FieldMappingResult | null,
  settledFile: ImportedExcelFile | undefined,
  settledMapping: FieldMappingResult | null,
): { ok: boolean; message?: string; result?: SettlementPreprocessResult } {
  const can = canPreprocessSettlement(pendingFile, pendingMapping, settledFile, settledMapping)
  if (!can.ok) return { ok: false, message: can.reason }

  const pendingRecords =
    pendingFile && pendingMapping
      ? normalizeSettlementRecords(pendingFile, pendingMapping, 'pending')
      : []
  const settledRecords =
    settledFile && settledMapping
      ? normalizeSettlementRecords(settledFile, settledMapping, 'settled')
      : []

  const pendingSplit = splitValidAndAbnormal(pendingRecords)
  const settledSplit = splitValidAndAbnormal(settledRecords)

  const settledMissingTimeCount = settledRecords.filter((r) =>
    r.errors.includes('结算时间解析失败'),
  ).length

  const result: SettlementPreprocessResult = {
    pendingRecords: pendingSplit.valid,
    settledRecords: settledSplit.valid,
    abnormalPendingRecords: pendingSplit.abnormal,
    abnormalSettledRecords: settledSplit.abnormal,
    summary: {
      pendingRawRows: pendingRecords.length,
      pendingValidCount: pendingSplit.valid.length,
      pendingAbnormalCount: pendingSplit.abnormal.length,
      pendingIncomeCent: sumByDirection(pendingRecords, 'income'),
      pendingRefundCent: sumByDirection(pendingRecords, 'refund'),
      pendingFeeCent: sumByDirection(pendingRecords, 'fee'),
      pendingMissingOrderIdCount: pendingRecords.filter((r) => r.errors.includes('缺少订单号')).length,
      pendingMoneyParseFailCount: pendingRecords.filter((r) => r.errors.includes('金额解析失败')).length,
      settledRawRows: settledRecords.length,
      settledValidCount: settledSplit.valid.length,
      settledAbnormalCount: settledSplit.abnormal.length,
      settledIncomeCent: sumByDirection(settledRecords, 'income'),
      settledRefundCent: sumByDirection(settledRecords, 'refund'),
      settledFeeCent: sumByDirection(settledRecords, 'fee'),
      settledMissingOrderIdCount: settledRecords.filter((r) => r.errors.includes('缺少订单号')).length,
      settledMoneyParseFailCount: settledRecords.filter((r) => r.errors.includes('金额解析失败')).length,
      settledMissingTimeCount,
    },
  }

  return { ok: true, result }
}
