import type {
  ExcelParseResult,
  FieldMappingResult,
  NormalizedOrder,
  SettlementPreprocessResult,
  SettlementRecord,
} from '../types/analysis'
import { sumCent } from '../utils/money'
import { normalizeSettlementRecords } from './settlement-normalizer.service'
import {
  resolveSettlementRecordCanonicalOrderId,
  type OrderSettlementKeyIndex,
} from './settlement-order-key-match.util'

function splitValid(records: SettlementRecord[]) {
  const valid: SettlementRecord[] = []
  const abnormal: SettlementRecord[] = []
  for (const r of records) {
    if (r.errors.length) abnormal.push(r)
    else valid.push(r)
  }
  return { valid, abnormal }
}

export function preprocessSettlementFromRecords(
  pendingRecords: SettlementRecord[],
  settledRecords: SettlementRecord[],
): SettlementPreprocessResult {
  const pendingSplit = splitValid(pendingRecords)
  const settledSplit = splitValid(settledRecords)
  return {
    pendingRecords: pendingSplit.valid,
    settledRecords: settledSplit.valid,
    abnormalPendingRecords: pendingSplit.abnormal,
    abnormalSettledRecords: settledSplit.abnormal,
  }
}

export function preprocessSettlement(
  pending?: { parsed: ExcelParseResult; mapping: FieldMappingResult },
  settled?: { parsed: ExcelParseResult; mapping: FieldMappingResult },
): SettlementPreprocessResult {
  const pendingAll = pending
    ? normalizeSettlementRecords(pending.parsed, pending.mapping, 'pending')
    : []
  const settledAll = settled
    ? normalizeSettlementRecords(settled.parsed, settled.mapping, 'settled')
    : []

  const pendingSplit = splitValid(pendingAll)
  const settledSplit = splitValid(settledAll)

  return {
    pendingRecords: pendingSplit.valid,
    settledRecords: settledSplit.valid,
    abnormalPendingRecords: pendingSplit.abnormal,
    abnormalSettledRecords: settledSplit.abnormal,
  }
}

interface AnchorSettlementBucket {
  settledIncomeCent: number
  pendingIncomeCent: number
  refundCent: number
  feeCent: number
}

export interface SettlementMaps {
  refundByOrder: Map<string, number>
  billUnmatchedCount: number
  byAnchor: Map<string, AnchorSettlementBucket>
}

export function buildSettlementMaps(
  settlement: SettlementPreprocessResult | undefined,
  orderKeyIndex: OrderSettlementKeyIndex,
): SettlementMaps {
  const refundByOrder = new Map<string, number>()
  const byAnchor = new Map<string, AnchorSettlementBucket>()
  let billUnmatchedCount = 0

  const touch = (anchorId: string): AnchorSettlementBucket => {
    if (!byAnchor.has(anchorId)) {
      byAnchor.set(anchorId, {
        settledIncomeCent: 0,
        pendingIncomeCent: 0,
        refundCent: 0,
        feeCent: 0,
      })
    }
    return byAnchor.get(anchorId)!
  }

  const ingest = (records: SettlementRecord[], billType: 'pending' | 'settled') => {
    for (const r of records) {
      const canonicalOrderId = resolveSettlementRecordCanonicalOrderId(r, orderKeyIndex)
      if (!canonicalOrderId) {
        billUnmatchedCount += 1
        continue
      }

      const anchorId = orderKeyIndex.anchorByCanonicalOrderId.get(canonicalOrderId)
      if (!anchorId) {
        billUnmatchedCount += 1
        if (r.direction === 'refund') {
          refundByOrder.set(
            canonicalOrderId,
            (refundByOrder.get(canonicalOrderId) ?? 0) + Math.abs(r.amountCent),
          )
        }
        continue
      }

      const bucket = touch(anchorId)
      if (r.direction === 'income') {
        const inc = Math.max(0, r.amountCent)
        if (billType === 'pending') {
          bucket.pendingIncomeCent += inc
        } else {
          bucket.settledIncomeCent += inc
        }
      }
      if (r.direction === 'refund') {
        const abs = Math.abs(r.amountCent)
        bucket.refundCent += abs
        refundByOrder.set(canonicalOrderId, (refundByOrder.get(canonicalOrderId) ?? 0) + abs)
      }
      if (r.direction === 'fee') {
        bucket.feeCent += Math.abs(r.amountCent)
      }
    }
  }

  if (settlement) {
    ingest(
      [...settlement.pendingRecords, ...settlement.abnormalPendingRecords],
      'pending',
    )
    ingest(
      [...settlement.settledRecords, ...settlement.abnormalSettledRecords],
      'settled',
    )
  }

  return { refundByOrder, billUnmatchedCount, byAnchor }
}

export function sumSettlementDirection(
  settlement: SettlementPreprocessResult | undefined,
  type: 'pending' | 'settled',
  direction: SettlementRecord['direction'],
): number {
  if (!settlement) return 0
  const list =
    type === 'pending'
      ? [...settlement.pendingRecords, ...settlement.abnormalPendingRecords]
      : [...settlement.settledRecords, ...settlement.abnormalSettledRecords]
  return sumCent(
    list
      .filter((r) => r.direction === direction)
      .map((r) => {
        if (direction === 'refund' || direction === 'fee') return Math.abs(r.amountCent)
        return Math.max(0, r.amountCent)
      }),
  )
}
