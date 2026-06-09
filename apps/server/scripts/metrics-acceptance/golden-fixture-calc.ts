/**
 * 固定黄金快照 fixture 纯计算（不依赖 live 库全天数据）
 */
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { resolveDateRange } from '../../src/utils/date-range'
import { aggregateSuccessfulRefundCentInRange } from '../../src/services/strict-after-sale-metrics.service'
import { centToYuan } from '../../src/utils/money'

export interface GoldenSnapshotFixture {
  id: string
  date: string
  description: string
  source: string
  expectations: {
    paidAmountCent: number
    paidOrderCount: number
    refundAmountCent: number
  }
  orders: Array<{
    orderNo: string
    payTime: string
    paidAmountCent: number
    anchorName: string
    orderStatus: string
  }>
  afterSales: Array<{
    orderNo: string
    refundFeeCent: number
    refundOkTime: string
    refundStatusName: string
    refunded: boolean
  }>
}

export interface GoldenComputedMetrics {
  paidOrderCount: number
  paidAmountCent: number
  refundAmountCent: number
  paidAmountYuan: number
  refundAmountYuan: number
}

const FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'official-2026-05-28-snapshot.json',
)

export function loadGoldenSnapshotFixture(): GoldenSnapshotFixture {
  const raw = readFileSync(FIXTURE_PATH, 'utf8')
  return JSON.parse(raw) as GoldenSnapshotFixture
}

function parseLocalDateTime(text: string): number {
  const normalized = text.trim().replace(' ', 'T')
  const withSec = normalized.length === 16 ? `${normalized}:00` : normalized
  const ms = Date.parse(`${withSec}+08:00`)
  if (Number.isFinite(ms)) return ms
  return Date.parse(withSec)
}

export function computeGoldenMetricsFromFixture(
  fixture: GoldenSnapshotFixture,
): GoldenComputedMetrics {
  const range = resolveDateRange('custom', fixture.date, fixture.date)

  const paidOrderNos = new Set<string>()
  let paidAmountCent = 0
  for (const o of fixture.orders) {
    if (!o.orderNo.startsWith('P')) continue
    paidOrderNos.add(o.orderNo)
    paidAmountCent += o.paidAmountCent
  }

  const afterSaleRecords = fixture.afterSales.map((a) => ({
    refund_fee: a.refundFeeCent / 100,
    refund_ok_time: parseLocalDateTime(a.refundOkTime),
    refund_status_name: a.refundStatusName,
    refunded: a.refunded,
  }))

  const refundAmountCent = aggregateSuccessfulRefundCentInRange(afterSaleRecords, range)

  return {
    paidOrderCount: paidOrderNos.size,
    paidAmountCent,
    refundAmountCent,
    paidAmountYuan: centToYuan(paidAmountCent),
    refundAmountYuan: centToYuan(refundAmountCent),
  }
}
