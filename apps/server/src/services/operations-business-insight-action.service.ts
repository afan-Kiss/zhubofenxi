import { prisma } from '../lib/prisma'
import { addDaysShanghai, endOfDayMsShanghai, formatDateKeyShanghai, startOfDayMsShanghai } from '../utils/business-timezone'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import type {
  BusinessInsightActionState,
  BusinessInsightsPayload,
} from './operations-business-insights.types'

export type BusinessInsightActionStatus = 'pending' | 'handled' | 'ignored' | 'reviewed'

export type BusinessInsightActionScope = 'daily' | 'weekly' | 'custom'

export type BusinessInsightEntityType =
  | 'anchor'
  | 'product'
  | 'price_band'
  | 'after_sales_reason'
  | 'system'

export const BUSINESS_INSIGHT_ACTION_STATUSES: BusinessInsightActionStatus[] = [
  'pending',
  'handled',
  'ignored',
  'reviewed',
]

export const BUSINESS_INSIGHT_ACTION_SCOPES: BusinessInsightActionScope[] = [
  'daily',
  'weekly',
  'custom',
]

export const BUSINESS_INSIGHT_ENTITY_TYPES: BusinessInsightEntityType[] = [
  'anchor',
  'product',
  'price_band',
  'after_sales_reason',
  'system',
]

export const MAX_INSIGHT_NOTE_LENGTH = 500

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export class BusinessInsightActionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BusinessInsightActionValidationError'
  }
}

export interface OperationsBusinessInsightActionRecord {
  id: string
  insightId: string
  insightType: string
  entityType: BusinessInsightEntityType
  entityId: string | null
  entityName: string
  rangeStartDate: string
  rangeEndDate: string
  scope: BusinessInsightActionScope
  status: BusinessInsightActionStatus
  note: string | null
  reviewResult: string | null
  remindTomorrow: boolean
  createdAt: string
  updatedAt: string
}

function assertDateKey(value: string, label: string): void {
  if (!DATE_KEY_RE.test(value)) {
    throw new BusinessInsightActionValidationError(`${label} 格式应为 YYYY-MM-DD`)
  }
}

function assertTextLength(value: string | undefined, label: string): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (trimmed.length > MAX_INSIGHT_NOTE_LENGTH) {
    throw new BusinessInsightActionValidationError(
      `${label} 不能超过 ${MAX_INSIGHT_NOTE_LENGTH} 字`,
    )
  }
  return trimmed.length > 0 ? trimmed : null
}

function toRecord(row: {
  id: string
  insightId: string
  insightType: string
  entityType: string
  entityId: string | null
  entityName: string
  rangeStartDate: string
  rangeEndDate: string
  scope: string
  status: string
  note: string | null
  reviewResult: string | null
  remindTomorrow: boolean
  createdAt: Date
  updatedAt: Date
}): OperationsBusinessInsightActionRecord {
  return {
    id: row.id,
    insightId: row.insightId,
    insightType: row.insightType,
    entityType: row.entityType as BusinessInsightEntityType,
    entityId: row.entityId,
    entityName: row.entityName,
    rangeStartDate: row.rangeStartDate,
    rangeEndDate: row.rangeEndDate,
    scope: row.scope as BusinessInsightActionScope,
    status: row.status as BusinessInsightActionStatus,
    note: row.note,
    reviewResult: row.reviewResult,
    remindTomorrow: row.remindTomorrow,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toActionState(row: OperationsBusinessInsightActionRecord): BusinessInsightActionState {
  return {
    status: row.status,
    note: row.note ?? undefined,
    reviewResult: row.reviewResult ?? undefined,
    remindTomorrow: row.remindTomorrow,
    updatedAt: row.updatedAt,
  }
}

export function validateListBusinessInsightActionsParams(params: {
  startDate: string
  endDate: string
  scope: string
}): { startDate: string; endDate: string; scope: BusinessInsightActionScope } {
  assertDateKey(params.startDate, 'startDate')
  assertDateKey(params.endDate, 'endDate')
  if (!BUSINESS_INSIGHT_ACTION_SCOPES.includes(params.scope as BusinessInsightActionScope)) {
    throw new BusinessInsightActionValidationError('scope 须为 daily、weekly 或 custom')
  }
  if (params.startDate > params.endDate) {
    throw new BusinessInsightActionValidationError('startDate 不能晚于 endDate')
  }
  return {
    startDate: params.startDate,
    endDate: params.endDate,
    scope: params.scope as BusinessInsightActionScope,
  }
}

export function validateUpsertBusinessInsightActionParams(params: {
  insightId: string
  insightType: string
  entityType: string
  entityId?: string
  entityName: string
  rangeStartDate: string
  rangeEndDate: string
  scope: string
  status: string
  note?: string
  reviewResult?: string
  remindTomorrow?: boolean
}): {
  insightId: string
  insightType: string
  entityType: BusinessInsightEntityType
  entityId: string | null
  entityName: string
  rangeStartDate: string
  rangeEndDate: string
  scope: BusinessInsightActionScope
  status: BusinessInsightActionStatus
  note: string | null
  reviewResult: string | null
  remindTomorrow: boolean
} {
  if (!params.insightId.trim()) {
    throw new BusinessInsightActionValidationError('请提供 insightId')
  }
  if (!params.insightType.trim()) {
    throw new BusinessInsightActionValidationError('请提供 insightType')
  }
  if (!params.entityName.trim()) {
    throw new BusinessInsightActionValidationError('请提供 entityName')
  }
  if (!BUSINESS_INSIGHT_ENTITY_TYPES.includes(params.entityType as BusinessInsightEntityType)) {
    throw new BusinessInsightActionValidationError('entityType 非法')
  }
  if (!BUSINESS_INSIGHT_ACTION_STATUSES.includes(params.status as BusinessInsightActionStatus)) {
    throw new BusinessInsightActionValidationError('status 非法')
  }
  assertDateKey(params.rangeStartDate, 'rangeStartDate')
  assertDateKey(params.rangeEndDate, 'rangeEndDate')
  if (params.rangeStartDate > params.rangeEndDate) {
    throw new BusinessInsightActionValidationError('rangeStartDate 不能晚于 rangeEndDate')
  }
  if (!BUSINESS_INSIGHT_ACTION_SCOPES.includes(params.scope as BusinessInsightActionScope)) {
    throw new BusinessInsightActionValidationError('scope 须为 daily、weekly 或 custom')
  }

  return {
    insightId: params.insightId.trim(),
    insightType: params.insightType.trim(),
    entityType: params.entityType as BusinessInsightEntityType,
    entityId: params.entityId?.trim() ? params.entityId.trim() : null,
    entityName: params.entityName.trim(),
    rangeStartDate: params.rangeStartDate,
    rangeEndDate: params.rangeEndDate,
    scope: params.scope as BusinessInsightActionScope,
    status: params.status as BusinessInsightActionStatus,
    note: assertTextLength(params.note, 'note'),
    reviewResult: assertTextLength(params.reviewResult, 'reviewResult'),
    remindTomorrow: Boolean(params.remindTomorrow),
  }
}

export async function listBusinessInsightActions(params: {
  startDate: string
  endDate: string
  scope: string
}): Promise<OperationsBusinessInsightActionRecord[]> {
  const validated = validateListBusinessInsightActionsParams(params)
  const rows = await prisma.operationsBusinessInsightAction.findMany({
    where: {
      rangeStartDate: validated.startDate,
      rangeEndDate: validated.endDate,
      scope: validated.scope,
    },
    orderBy: { updatedAt: 'desc' },
  })
  return rows.map(toRecord)
}

export async function upsertBusinessInsightAction(params: {
  insightId: string
  insightType: string
  entityType: string
  entityId?: string
  entityName: string
  rangeStartDate: string
  rangeEndDate: string
  scope: string
  status: string
  note?: string
  reviewResult?: string
  remindTomorrow?: boolean
}): Promise<OperationsBusinessInsightActionRecord> {
  const validated = validateUpsertBusinessInsightActionParams(params)
  const row = await prisma.operationsBusinessInsightAction.upsert({
    where: {
      insightId_rangeStartDate_rangeEndDate_scope: {
        insightId: validated.insightId,
        rangeStartDate: validated.rangeStartDate,
        rangeEndDate: validated.rangeEndDate,
        scope: validated.scope,
      },
    },
    create: {
      insightId: validated.insightId,
      insightType: validated.insightType,
      entityType: validated.entityType,
      entityId: validated.entityId,
      entityName: validated.entityName,
      rangeStartDate: validated.rangeStartDate,
      rangeEndDate: validated.rangeEndDate,
      scope: validated.scope,
      status: validated.status,
      note: validated.note,
      reviewResult: validated.reviewResult,
      remindTomorrow: validated.remindTomorrow,
    },
    update: {
      insightType: validated.insightType,
      entityType: validated.entityType,
      entityId: validated.entityId,
      entityName: validated.entityName,
      status: validated.status,
      note: validated.note,
      reviewResult: validated.reviewResult,
      remindTomorrow: validated.remindTomorrow,
    },
  })
  return toRecord(row)
}

export function mergeBusinessInsightActions(
  payload: BusinessInsightsPayload,
  actions: OperationsBusinessInsightActionRecord[],
): BusinessInsightsPayload {
  const map = new Map(actions.map((a) => [a.insightId, toActionState(a)]))
  return {
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      actionState: map.get(item.id) ?? { status: 'pending' },
    })),
  }
}

export async function attachBusinessInsightActions(
  payload: BusinessInsightsPayload,
  params: { startDate: string; endDate: string; scope: string },
): Promise<BusinessInsightsPayload> {
  const actions = await listBusinessInsightActions(params)
  return mergeBusinessInsightActions(payload, actions)
}

export interface BusinessInsightActionStatsSummary {
  total: number
  pending: number
  handled: number
  reviewed: number
  ignored: number
  handleRate: number | null
  ignoreRate: number | null
}

export interface BusinessInsightActionStatsBucket {
  key: string
  total: number
  pending: number
  handled: number
  reviewed: number
  ignored: number
  handleRate: number | null
  ignoreRate: number | null
}

export interface BusinessInsightActionStatsDailyTrend {
  date: string
  total: number
  pending: number
  handled: number
  reviewed: number
  ignored: number
  handleRate: number | null
}

export interface BusinessInsightActionStatsPayload {
  summary: BusinessInsightActionStatsSummary
  byType: BusinessInsightActionStatsBucket[]
  byEntityType: BusinessInsightActionStatsBucket[]
  dailyTrend: BusinessInsightActionStatsDailyTrend[]
}

function countByStatus(rows: OperationsBusinessInsightActionRecord[]): Omit<
  BusinessInsightActionStatsSummary,
  'handleRate' | 'ignoreRate'
> {
  const counts = { total: rows.length, pending: 0, handled: 0, reviewed: 0, ignored: 0 }
  for (const row of rows) {
    counts[row.status] += 1
  }
  return counts
}

function withRates(
  counts: Omit<BusinessInsightActionStatsSummary, 'handleRate' | 'ignoreRate'>,
): BusinessInsightActionStatsSummary {
  return {
    ...counts,
    handleRate: counts.total > 0 ? (counts.handled + counts.reviewed) / counts.total : null,
    ignoreRate: counts.total > 0 ? counts.ignored / counts.total : null,
  }
}

function toBucket(key: string, rows: OperationsBusinessInsightActionRecord[]): BusinessInsightActionStatsBucket {
  const counts = countByStatus(rows)
  return {
    key,
    ...counts,
    handleRate: counts.total > 0 ? (counts.handled + counts.reviewed) / counts.total : null,
    ignoreRate: counts.total > 0 ? counts.ignored / counts.total : null,
  }
}

function groupByKey(
  rows: OperationsBusinessInsightActionRecord[],
  pick: (row: OperationsBusinessInsightActionRecord) => string,
): BusinessInsightActionStatsBucket[] {
  const map = new Map<string, OperationsBusinessInsightActionRecord[]>()
  for (const row of rows) {
    const key = pick(row)
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return [...map.entries()]
    .map(([key, group]) => toBucket(key, group))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key, 'zh-CN'))
}

export async function getBusinessInsightActionStats(params: {
  startDate: string
  endDate: string
  scope: string
}): Promise<BusinessInsightActionStatsPayload> {
  const validated = validateListBusinessInsightActionsParams(params)
  const rows = await listBusinessInsightActions(validated)
  const summary = withRates(countByStatus(rows))
  const byType = groupByKey(rows, (row) => row.insightType)
  const byEntityType = groupByKey(rows, (row) => row.entityType)

  const trendEnd = validated.endDate
  const trendStart = addDaysShanghai(trendEnd, -6)
  const trendDays = eachDayInShanghaiRange(trendStart, trendEnd)
  const trendRows = await prisma.operationsBusinessInsightAction.findMany({
    where: {
      scope: validated.scope,
      updatedAt: {
        gte: new Date(startOfDayMsShanghai(trendStart)),
        lte: new Date(endOfDayMsShanghai(trendEnd)),
      },
    },
  })
  const trendByDay = new Map<string, OperationsBusinessInsightActionRecord[]>()
  for (const day of trendDays) {
    trendByDay.set(day, [])
  }
  for (const row of trendRows) {
    const dayKey = formatDateKeyShanghai(row.updatedAt)
    const bucket = trendByDay.get(dayKey)
    if (bucket) bucket.push(toRecord(row))
  }
  const dailyTrend: BusinessInsightActionStatsDailyTrend[] = trendDays.map((date) => {
    const counts = countByStatus(trendByDay.get(date) ?? [])
    return {
      date,
      ...counts,
      handleRate: counts.total > 0 ? (counts.handled + counts.reviewed) / counts.total : null,
    }
  })

  return { summary, byType, byEntityType, dailyTrend }
}
