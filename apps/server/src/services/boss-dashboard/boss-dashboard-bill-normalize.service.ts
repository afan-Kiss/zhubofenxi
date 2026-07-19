import {
  BOSS_BILL_FEE_CODES,
  BOSS_BILL_RECONCILE_TOLERANCE_CENT,
} from '../../config/boss-dashboard.constants'
import { yuanStringToCent } from './boss-dashboard-normalize.service'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (v == null) continue
    const s = String(v).trim()
    if (s) return s
  }
  return null
}

function pickInt(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (v == null || v === '') continue
    const n = typeof v === 'number' ? v : Number(String(v))
    if (Number.isFinite(n)) return Math.round(n)
  }
  return null
}

export type SettleBillField = {
  code: string
  value: unknown
  displayValue?: string
}

export function readSettleBillField(fields: SettleBillField[], code: string): SettleBillField | null {
  return fields.find((f) => f.code === code) ?? null
}

/** settleBill / feeDetailInfo 数组里 value 为分的字段 */
const SETTLE_BILL_VALUE_CENT_CODES = new Set([
  'SELLER_INCOME',
  'TOTAL_IN_AMOUNT',
  'TOTAL_OUT_AMOUNT',
  'TOTAL_GOODS_COMMISSION',
  'TOTAL_CPS_COMMISSION',
  'TOTAL_INSTALLMENT_AMOUNT',
  ...BOSS_BILL_FEE_CODES,
])

function parseBillArrayValueCent(raw: unknown, displayValue?: unknown): number | null {
  if (raw == null || raw === '') {
    if (displayValue != null && displayValue !== '') {
      return yuanStringToCent(displayValue, 'displayValue')
    }
    return null
  }
  const sv = String(raw).trim()
  if (!sv) return null
  if (!sv.includes('.') && /^-?\d+$/.test(sv)) {
    const n = Number(sv)
    if (Number.isFinite(n)) return Math.round(n)
  }
  const fromRaw = yuanStringToCent(raw, 'value')
  if (fromRaw != null) return fromRaw
  if (displayValue != null && displayValue !== '') {
    return yuanStringToCent(displayValue, 'displayValue')
  }
  return null
}

/** SELLER_INCOME.value 为分；feeDetailInfo 数组 value 亦为分 */
export function parseSettleBillCentField(field: SettleBillField | null, fieldName: string): number | null {
  if (!field || field.value == null || field.value === '') return null
  if (SETTLE_BILL_VALUE_CENT_CODES.has(fieldName)) {
    return parseBillArrayValueCent(field.value, field.displayValue)
  }
  return yuanStringToCent(field.value, fieldName)
}

export function parseBossBillDateTime(raw: unknown): Date | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(`${s}T00:00:00+08:00`)
  }
  const normalized = s.includes('T') ? s : s.replace(' ', 'T')
  const d = new Date(`${normalized}+08:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

export interface ParsedBossStoreInfo {
  settlePeriodDays: number | null
  switchNewBill: boolean | null
  switchDefaultNewBill: boolean | null
}

export function parseBossStoreInfo(payload: unknown): ParsedBossStoreInfo {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  return {
    settlePeriodDays: pickInt(data, ['settlePeriod']),
    switchNewBill: typeof data.switchNewBill === 'boolean' ? data.switchNewBill : null,
    switchDefaultNewBill:
      typeof data.switchDefaultNewBill === 'boolean' ? data.switchDefaultNewBill : null,
  }
}

export interface ParsedBossSellerPreIncome {
  allAmountCent: number | null
  sellerAccountAmountCent: number | null
  alipayAmountCent: number | null
  wechatAmountCent: number | null
}

export function parseBossSellerPreIncome(payload: unknown): ParsedBossSellerPreIncome {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  return {
    allAmountCent: yuanStringToCent(data.allAmount, 'allAmount'),
    sellerAccountAmountCent: yuanStringToCent(data.sellerAccountAmount, 'sellerAccountAmount'),
    alipayAmountCent: yuanStringToCent(data.alipayAmount, 'alipayAmount'),
    wechatAmountCent: yuanStringToCent(data.wechatAmount, 'wechatAmount'),
  }
}

export interface ParsedBossPendingSettleOrder {
  platformSettleNo: string
  packageId: string | null
  orderCreateTime: Date | null
  orderStatus: string | null
  orderFinishTime: Date | null
  settleStatus: string | null
  expectedSettleTime: Date | null
  transactionType: string | null
  sellerIncomeCent: number | null
  totalIncomeCent: number | null
  totalOutcomeCent: number | null
  platformCommissionCent: number | null
  cpsCommissionCent: number | null
  installmentFeeCent: number | null
}

export function buildPendingSettleStableKey(
  shopKey: string,
  packageId: string | null,
  transactionType: string | null,
): string {
  return `${shopKey}:${packageId ?? 'unknown'}:${transactionType ?? 'unknown'}`
}

export function parseBossPendingSettleOrderRow(
  row: Record<string, unknown>,
  shopKey: string,
): ParsedBossPendingSettleOrder | null {
  const settleBillRaw = row.settleBill
  const fields: SettleBillField[] = Array.isArray(settleBillRaw)
    ? settleBillRaw.flatMap((item) => {
        const rec = asRecord(item)
        if (!rec?.code) return []
        return [
          {
            code: String(rec.code),
            value: rec.value,
            displayValue: rec.displayValue != null ? String(rec.displayValue) : undefined,
          },
        ]
      })
    : []

  const settleNoField = readSettleBillField(fields, 'SETTLE_NO')
  const settleNo = settleNoField?.value != null ? String(settleNoField.value).trim() : null

  const packageField = readSettleBillField(fields, 'PACKAGE_ID')
  const transField = readSettleBillField(fields, 'TRANS_TYPE')
  const packageId = packageField?.value != null ? String(packageField.value).trim() : null
  const transactionType = transField?.value != null ? String(transField.value).trim() : null

  const platformSettleNo =
    settleNo || buildPendingSettleStableKey(shopKey, packageId, transactionType)

  if (!platformSettleNo) return null

  return {
    platformSettleNo,
    packageId,
    orderCreateTime: parseBossBillDateTime(readSettleBillField(fields, 'ORDER_CREATE_TIME')?.value),
    orderStatus:
      readSettleBillField(fields, 'ORDER_STATUS')?.value != null
        ? String(readSettleBillField(fields, 'ORDER_STATUS')!.value)
        : null,
    orderFinishTime: parseBossBillDateTime(readSettleBillField(fields, 'ORDER_FINISH_TIME')?.value),
    settleStatus:
      readSettleBillField(fields, 'SETTLE_STATUS')?.value != null
        ? String(readSettleBillField(fields, 'SETTLE_STATUS')!.value)
        : null,
    expectedSettleTime: parseBossBillDateTime(readSettleBillField(fields, 'CAN_SETTLE_TIME')?.value),
    transactionType,
    sellerIncomeCent: parseSettleBillCentField(readSettleBillField(fields, 'SELLER_INCOME'), 'SELLER_INCOME'),
    totalIncomeCent: parseSettleBillCentField(readSettleBillField(fields, 'TOTAL_IN_AMOUNT'), 'TOTAL_IN_AMOUNT'),
    totalOutcomeCent: parseSettleBillCentField(readSettleBillField(fields, 'TOTAL_OUT_AMOUNT'), 'TOTAL_OUT_AMOUNT'),
    platformCommissionCent: parseSettleBillCentField(
      readSettleBillField(fields, 'TOTAL_GOODS_COMMISSION'),
      'TOTAL_GOODS_COMMISSION',
    ),
    cpsCommissionCent: parseSettleBillCentField(
      readSettleBillField(fields, 'TOTAL_CPS_COMMISSION'),
      'TOTAL_CPS_COMMISSION',
    ),
    installmentFeeCent: parseSettleBillCentField(
      readSettleBillField(fields, 'TOTAL_INSTALLMENT_AMOUNT'),
      'TOTAL_INSTALLMENT_AMOUNT',
    ),
  }
}

export interface ParsedBossSettleBillListPage {
  rows: ParsedBossPendingSettleOrder[]
  totalPage: number
  pageNum: number
}

export function parseBossSettleBillListPage(payload: unknown, shopKey: string): ParsedBossSettleBillListPage {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  const list = Array.isArray(data.list) ? data.list : []
  const rows: ParsedBossPendingSettleOrder[] = []
  for (const item of list) {
    const rec = asRecord(item)
    if (!rec) continue
    const parsed = parseBossPendingSettleOrderRow(rec, shopKey)
    if (parsed) rows.push(parsed)
  }
  return {
    rows,
    totalPage: pickInt(data, ['totalPage']) ?? 1,
    pageNum: pickInt(data, ['pageNum']) ?? 1,
  }
}

export type BossFeeDetailMap = Record<string, number | null>

export function parseBossFeeDetailInfo(raw: unknown): BossFeeDetailMap {
  const result: BossFeeDetailMap = {}
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const rec = asRecord(item)
      if (!rec?.code) continue
      const code = String(rec.code)
      const cent = parseBillArrayValueCent(rec.value, rec.displayValue)
      if (cent != null) result[code] = cent
    }
    for (const code of BOSS_BILL_FEE_CODES) {
      if (!(code in result)) result[code] = null
    }
    return result
  }
  const root = asRecord(raw) ?? {}
  for (const code of BOSS_BILL_FEE_CODES) {
    const v = root[code]
    if (v == null || v === '') {
      result[code] = null
      continue
    }
    // DB 回读：整数（含整数 string）按「分」；带小数的数字/字符串按「元」转分
    if (typeof v === 'number' && Number.isFinite(v)) {
      result[code] = Number.isInteger(v) ? Math.round(v) : Math.round(v * 100)
      continue
    }
    const asText = String(v).trim()
    if (/^-?\d+$/.test(asText)) {
      const n = Number(asText)
      result[code] = Number.isFinite(n) ? Math.round(n) : null
      continue
    }
    result[code] = yuanStringToCent(v, code)
  }
  return result
}

/** 读取已落库的 feeDetailJson（分）；兼容历史错误二次放大后的超大值时不再二次换算 */
export function readStoredBossFeeDetailJson(rawJson: string | null | undefined): BossFeeDetailMap {
  if (!rawJson) return {}
  try {
    return parseBossFeeDetailInfo(JSON.parse(rawJson))
  } catch {
    return {}
  }
}

export function sumFeeDetailExceptStatement(feeDetail: BossFeeDetailMap): number {
  let sum = 0
  for (const [code, cent] of Object.entries(feeDetail)) {
    if (code === 'STATEMENT_IN' || code === 'STATEMENT_REFUND') continue
    if (cent != null) sum += cent
  }
  return sum
}

export interface ParsedBossPeriodSettleBill {
  platformBillNo: string | null
  periodType: string
  periodStart: Date
  periodEnd: Date
  billDate: string | null
  processStatus: string | null
  settleOrderCount: number | null
  otherOrderCount: number | null
  totalCount: number | null
  totalIncomeCent: number | null
  totalOutcomeCent: number | null
  totalChangeCent: number | null
  totalCommissionCent: number | null
  feeDetail: BossFeeDetailMap
  processFinishedAt: Date | null
}

export function parseBossPeriodSettleBillRow(row: Record<string, unknown>): ParsedBossPeriodSettleBill | null {
  const periodType = pickString(row, ['periodType'])
  const startRaw = pickString(row, ['startTime'])
  const endRaw = pickString(row, ['endTime'])
  const periodStart = parseBossBillDateTime(startRaw)
  const periodEnd = parseBossBillDateTime(endRaw)
  if (!periodType || !periodStart || !periodEnd) return null

  return {
    platformBillNo: pickString(row, ['periodSettleNo']),
    periodType,
    periodStart,
    periodEnd,
    billDate: pickString(row, ['billDate']),
    processStatus: pickString(row, ['processStatus']),
    settleOrderCount: pickInt(row, ['settleOrderCount']),
    otherOrderCount: pickInt(row, ['otherOrderCount']),
    totalCount: pickInt(row, ['totalCount']),
    totalIncomeCent: yuanStringToCent(row.totalIncomeAmount, 'totalIncomeAmount'),
    totalOutcomeCent: yuanStringToCent(row.totalOutcomeAmount, 'totalOutcomeAmount'),
    totalChangeCent: yuanStringToCent(row.totalChangeAmount, 'totalChangeAmount'),
    totalCommissionCent: yuanStringToCent(row.totalCommissionAmount, 'totalCommissionAmount'),
    feeDetail: parseBossFeeDetailInfo(row.feeDetailInfo),
    processFinishedAt: parseBossBillDateTime(row.processFinishTime),
  }
}

export interface ParsedBossPeriodSettleBillPage {
  rows: ParsedBossPeriodSettleBill[]
  totalPage: number
  pageNum: number
}

export function parseBossPeriodSettleBillPage(payload: unknown): ParsedBossPeriodSettleBillPage {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  const list = Array.isArray(data.list) ? data.list : []
  const rows: ParsedBossPeriodSettleBill[] = []
  for (const item of list) {
    const rec = asRecord(item)
    if (!rec) continue
    const parsed = parseBossPeriodSettleBillRow(rec)
    if (parsed) rows.push(parsed)
  }
  return {
    rows,
    totalPage: pickInt(data, ['totalPage']) ?? 1,
    pageNum: pickInt(data, ['pageNum']) ?? 1,
  }
}

export interface ParsedBossPeriodFundBill {
  platformBillNo: string | null
  periodType: string
  periodStart: Date
  periodEnd: Date
  totalIncomeCent: number | null
  totalOutcomeCent: number | null
  totalChangeCent: number | null
  balanceBeforeCent: number | null
  balanceAfterCent: number | null
  totalCount: number | null
  processStatus: string | null
}

export function parseBossPeriodFundBillRow(row: Record<string, unknown>): ParsedBossPeriodFundBill | null {
  const periodType = pickString(row, ['periodType'])
  const periodStart = parseBossBillDateTime(row.startTime)
  const periodEnd = parseBossBillDateTime(row.endTime)
  if (!periodType || !periodStart || !periodEnd) return null
  return {
    platformBillNo: pickString(row, ['periodFundNo']),
    periodType,
    periodStart,
    periodEnd,
    totalIncomeCent: yuanStringToCent(row.totalInAmount, 'totalInAmount'),
    totalOutcomeCent: yuanStringToCent(row.totalOutAmount, 'totalOutAmount'),
    totalChangeCent: yuanStringToCent(row.totalChangeAmount, 'totalChangeAmount'),
    balanceBeforeCent: yuanStringToCent(row.balanceBefore, 'balanceBefore'),
    balanceAfterCent: yuanStringToCent(row.balanceAfter, 'balanceAfter'),
    totalCount: pickInt(row, ['totalCount']),
    processStatus: pickString(row, ['processStatus']),
  }
}

export function parseBossPeriodFundBillPage(payload: unknown): {
  rows: ParsedBossPeriodFundBill[]
  totalPage: number
} {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  const list = Array.isArray(data.list) ? data.list : []
  const rows: ParsedBossPeriodFundBill[] = []
  for (const item of list) {
    const rec = asRecord(item)
    if (!rec) continue
    const parsed = parseBossPeriodFundBillRow(rec)
    if (parsed) rows.push(parsed)
  }
  return {
    rows,
    totalPage: pickInt(data, ['totalPage']) ?? 1,
  }
}

export function checkPendingReconciliation(
  officialAmountCent: number | null,
  detailSumCent: number,
): { ok: boolean; diffCent: number | null } {
  if (officialAmountCent == null) return { ok: true, diffCent: null }
  const diff = Math.abs(officialAmountCent - detailSumCent)
  return {
    ok: diff <= BOSS_BILL_RECONCILE_TOLERANCE_CENT,
    diffCent: officialAmountCent - detailSumCent,
  }
}

export function formatBossBillDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`
}

export function buildThirtyDayWindows(
  rangeStartKey: string,
  rangeEndKey: string,
  windowDays: number,
  addDays: (dateKey: string, delta: number) => string,
): Array<{ startTime: string; endTime: string }> {
  const windows: Array<{ startTime: string; endTime: string }> = []
  let curKey = rangeStartKey
  while (curKey <= rangeEndKey) {
    const windowEndKey = addDays(curKey, windowDays - 1)
    const effectiveEnd = windowEndKey <= rangeEndKey ? windowEndKey : rangeEndKey
    windows.push({
      startTime: `${curKey} 00:00:00`,
      endTime: `${effectiveEnd} 23:59:59`,
    })
    curKey = addDays(effectiveEnd, 1)
  }
  return windows
}
