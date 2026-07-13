import { parseMoneyToCent } from '../../utils/amount-parse.service'
import { BOSS_FLOW_KIND, type BossFlowKind } from '../../config/boss-dashboard.constants'

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

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (v == null || v === '') continue
    const n = typeof v === 'number' ? v : Number(String(v))
    if (Number.isFinite(n)) return n
  }
  return null
}

export function yuanStringToCent(raw: unknown, fieldName?: string): number | null {
  if (raw == null || raw === '') return null
  const result = parseMoneyToCent(raw, raw, fieldName)
  if (result.strategy === 'value_as_cent' && result.cent > 0 && result.cent < 10000 && String(raw).includes('.')) {
    return Math.round(Number(String(raw).replace(/,/g, '')) * 100)
  }
  if (String(raw).includes('.') || (typeof raw === 'string' && raw.includes('.'))) {
    const n = Number(String(raw).replace(/[￥¥,\s]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 100) : null
  }
  return result.cent
}

export interface ParsedBossFundSnapshot {
  availableAmountCent: number | null
  withdrawingAmountCent: number | null
  balanceAmountCent: number | null
  frozenAmountCent: number | null
  yesterdayIncomeCent: number | null
  debtAmountCent: number | null
  depositBalanceCent: number | null
  depositRequiredCent: number | null
  depositStandardCent: number | null
  baseDueDepositCent: number | null
  riskDepositCent: number | null
  canWithdraw: boolean | null
  leftWithdrawTimesToday: number | null
  totalWithdrawTimesToday: number | null
  statementPeriodDays: number | null
}

export function parseBossAggregateAccount(payload: unknown): ParsedBossFundSnapshot {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  const accountVo = asRecord(data.accountVo) ?? {}
  const deposit = asRecord(data.depositAccountVo) ?? {}
  return {
    availableAmountCent: yuanStringToCent(accountVo.avilableAmount ?? accountVo.availableAmount, 'avilableAmount'),
    withdrawingAmountCent: yuanStringToCent(accountVo.withdrawingAmount, 'withdrawingAmount'),
    balanceAmountCent: yuanStringToCent(accountVo.totalAmount ?? data.totalAvailableAmount, 'totalAmount'),
    frozenAmountCent: yuanStringToCent(accountVo.frozenAmount ?? data.totalFrozenAmount, 'frozenAmount'),
    yesterdayIncomeCent: yuanStringToCent(
      accountVo.lastDayIncomeAmount ?? data.totalLastDayIncomeAmount,
      'lastDayIncomeAmount',
    ),
    debtAmountCent: yuanStringToCent(data.arrearsAmount, 'arrearsAmount'),
    depositBalanceCent: yuanStringToCent(deposit.balanceAmount ?? deposit.availableAmount, 'depositBalance'),
    depositRequiredCent: yuanStringToCent(deposit.totalDueAmountTrend ?? deposit.saleDepositAmount, 'depositRequired'),
    depositStandardCent: yuanStringToCent(deposit.standardAmount, 'standardAmount'),
    baseDueDepositCent: yuanStringToCent(deposit.baseDueAmount, 'baseDueAmount'),
    riskDepositCent: yuanStringToCent(deposit.riskDepositAmount ?? deposit.riskDepositBalance, 'riskDeposit'),
    canWithdraw: typeof accountVo.canWithdraw === 'boolean' ? accountVo.canWithdraw : null,
    leftWithdrawTimesToday: pickNumber(accountVo, ['leftTimesOneDay']),
    totalWithdrawTimesToday: pickNumber(accountVo, ['totalTimesOneDay']),
    statementPeriodDays: pickNumber(data, ['statementPeriod']),
  }
}

export function parseBossAfterSaleFrozen(payload: unknown): number | null {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  const raw = data.afterSaleFrozenAmount
  if (raw == null) return null
  if (typeof raw === 'number') return Math.round(raw * 100)
  return yuanStringToCent(raw, 'afterSaleFrozenAmount')
}

export function parseBossCanWithdraw(payload: unknown): {
  canWithdraw: boolean | null
  cannotWithdrawReason: string | null
} {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  return {
    canWithdraw: typeof data.canWithdraw === 'boolean' ? data.canWithdraw : null,
    cannotWithdrawReason: pickString(data, ['errorMsg', 'buttonDesc']),
  }
}

export interface ParsedBossFlowRow {
  platformFlowId: string
  flowKind: BossFlowKind
  flowType: string | null
  flowTypeDesc: string | null
  occurredAt: Date
  incomeAmountCent: number
  outcomeAmountCent: number
  businessNo: string | null
  balanceAfterCent: number | null
  raw: Record<string, unknown>
}

export function classifyBossFlow(row: Record<string, unknown>): BossFlowKind {
  const type = String(row.type ?? '').trim()
  const typeDesc = String(row.typeDesc ?? '').trim()
  const remark = String(row.remark ?? '').trim()
  const income = yuanStringToCent(row.incomeAmount, 'incomeAmount') ?? 0
  const outcome = yuanStringToCent(row.outcomeAmount, 'outcomeAmount') ?? 0
  if (
    type === 'PAY_SUCCESS' ||
    typeDesc === '提现' ||
    typeDesc.includes('提现') ||
    (outcome > 0 && /货款提现|提现[:：]/.test(remark))
  ) {
    return BOSS_FLOW_KIND.withdrawSuccess
  }
  if (
    (type === 'STATEMENT_IN' || typeDesc === '结算入账') &&
    income > 0
  ) {
    return BOSS_FLOW_KIND.statementIn
  }
  return BOSS_FLOW_KIND.other
}

export function parseBossFlowRow(row: Record<string, unknown>): ParsedBossFlowRow | null {
  const platformFlowId = pickString(row, ['tradeNo', 'id', 'flowId'])
  const created = pickString(row, ['createdTime', 'createTime', 'occurredAt'])
  if (!platformFlowId || !created) return null
  const occurredAt = new Date(created.replace(' ', 'T') + '+08:00')
  if (Number.isNaN(occurredAt.getTime())) return null
  return {
    platformFlowId,
    flowKind: classifyBossFlow(row),
    flowType: pickString(row, ['type']),
    flowTypeDesc: pickString(row, ['typeDesc']),
    occurredAt,
    incomeAmountCent: yuanStringToCent(row.incomeAmount, 'incomeAmount') ?? 0,
    outcomeAmountCent: yuanStringToCent(row.outcomeAmount, 'outcomeAmount') ?? 0,
    businessNo: pickString(row, ['businessNo']),
    balanceAfterCent: yuanStringToCent(row.balanceAmount, 'balanceAmount'),
    raw: row,
  }
}

export function parseBossAccountRecordPage(payload: unknown): {
  rows: ParsedBossFlowRow[]
  pageNum: number
  totalPage: number
  total: number
} {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  const list = Array.isArray(data.list) ? data.list : []
  const rows: ParsedBossFlowRow[] = []
  for (const item of list) {
    const rec = asRecord(item)
    if (!rec) continue
    const parsed = parseBossFlowRow(rec)
    if (parsed) rows.push(parsed)
  }
  return {
    rows,
    pageNum: pickNumber(data, ['pageNum']) ?? 1,
    totalPage: pickNumber(data, ['totalPage']) ?? 1,
    total: pickNumber(data, ['total']) ?? rows.length,
  }
}

export interface ParsedBossShopScores {
  scoreDate: string | null
  qualityScore: number | null
  logisticsScore: number | null
  serviceScore: number | null
  officialOverallScore: number | null
  raw: Record<string, unknown> | null
}

export function parseBossShopScore(payload: unknown): ParsedBossShopScores {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  const dto =
    asRecord(data.shop_score_dto) ??
    asRecord(data.shopScoreDto) ??
    asRecord(data.sellerScoreInfo) ??
    data
  const scoreDate =
    pickString(dto, ['scoreDate', 'date', 'indexDate', 'statDate']) ??
    pickString(data, ['scoreDate', 'date'])
  return {
    scoreDate,
    qualityScore:
      pickNumber(dto, ['sellerQualityScore', 'qualityScore', 'itemScore']) ??
      pickNumber(data, ['sellerQualityScore', 'qualityScore']),
    logisticsScore:
      pickNumber(dto, ['sellerLogisticsScore', 'logisticsScore', 'logisticScore']) ??
      pickNumber(data, ['sellerLogisticsScore', 'logisticsScore']),
    serviceScore:
      pickNumber(dto, ['sellerServiceScore', 'serviceScore', 'customerServiceScore']) ??
      pickNumber(data, ['sellerServiceScore', 'serviceScore']),
    officialOverallScore:
      pickNumber(dto, ['shopScore', 'shop_score', 'sellerShopScore', 'overallScore']) ??
      pickNumber(data, ['shopScore', 'shop_score', 'score']),
    raw: data,
  }
}

const BOSS_SCORE_TREND_RESPONSE_KEYS: Record<string, string[]> = {
  sellerQualityScore: ['sellerQualityScore'],
  logisticsScore: ['logisticsScore', 'sellerLogisticsScore'],
  customerServiceScore: ['customerServiceScore', 'sellerServiceScore', 'serviceScore'],
}

export function parseBossScoreTrend(payload: unknown, label: string): Array<{ date: string; score: number }> {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  const map = asRecord(data.sellerScoreTrendMap) ?? {}
  const candidateKeys = BOSS_SCORE_TREND_RESPONSE_KEYS[label] ?? [label]
  let list: unknown[] = []
  for (const key of candidateKeys) {
    if (Array.isArray(map[key])) {
      list = map[key] as unknown[]
      break
    }
  }
  const out: Array<{ date: string; score: number }> = []
  for (const item of list) {
    const rec = asRecord(item)
    if (!rec) continue
    const date = pickString(rec, ['date'])
    const score = pickNumber(rec, ['current', 'score'])
    if (date && score != null) out.push({ date, score })
  }
  return out
}

export function isSettlementIncomeRow(row: ParsedBossFlowRow): boolean {
  return row.flowKind === BOSS_FLOW_KIND.statementIn
}

export function isWithdrawSuccessRow(row: ParsedBossFlowRow): boolean {
  return row.flowKind === BOSS_FLOW_KIND.withdrawSuccess && row.outcomeAmountCent > 0
}
