import type { EffectiveScheduleRow, EffectiveScheduleSource } from '../services/anchor-daily-schedule.service'
import {
  buildVirtualSchedulesFromTemplates,
  type ScheduleTemplateSeed,
} from '../services/anchor-schedule-template.service'
import {
  filterVirtualSchedulesAgainstOccupied,
  type ScheduleOverlapInterval,
} from './anchor-schedule-time.util'
import { anchorNamesMatch, normalizeAnchorName } from './anchor-name-normalize.util'

export interface DbScheduleRowLike {
  id: string
  scheduleDate: string
  anchorName: string
  shopName: string
  liveRoomName: string
  startAt: Date
  endAt: Date
  source: string
  enabled: boolean
  confirmed: boolean
  note: string | null
}

export interface BuildEffectiveScheduleRowsResult {
  rows: EffectiveScheduleRow[]
  warnings: string[]
  sourceSummary: {
    manualCount: number
    generatedCount: number
    virtualCount: number
  }
}

function hmFromDate(d: Date, scheduleDate: string): string {
  const endDateKey = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const isMidnightEnd =
    d.getHours() === 0 && d.getMinutes() === 0 && endDateKey > scheduleDate
  if (isMidnightEnd) return '24:00'
  return d.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function dbRowToEffective(
  row: DbScheduleRowLike,
  source: EffectiveScheduleSource,
  dateConfirmed: boolean,
): EffectiveScheduleRow {
  return {
    rowId: row.id,
    source,
    anchorName: row.anchorName,
    shopName: row.shopName,
    liveRoomName: row.liveRoomName,
    startTime: hmFromDate(row.startAt, row.scheduleDate),
    endTime: hmFromDate(row.endAt, row.scheduleDate),
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    enabled: row.enabled,
    confirmed: dateConfirmed,
    note: row.note ?? undefined,
  }
}

function occupiedIntervalFromDbRow(row: DbScheduleRowLike): ScheduleOverlapInterval {
  return {
    anchorName: row.anchorName,
    shopName: row.shopName,
    liveRoomName: row.liveRoomName,
    startAt: row.startAt,
    endAt: row.endAt,
  }
}

function manualCoversFullBusinessDay(
  manualRows: DbScheduleRowLike[],
  expectedTemplateCount: number,
): boolean {
  if (expectedTemplateCount <= 0) return manualRows.length > 0
  const enabledManual = manualRows.filter((r) => r.enabled)
  return enabledManual.length >= expectedTemplateCount
}

function warnDuplicateAnchorsInEffectiveRows(
  effectiveRows: EffectiveScheduleRow[],
  warnings: string[],
): void {
  const counts = new Map<string, { displayName: string; count: number }>()
  for (const row of effectiveRows) {
    const key = normalizeAnchorName(row.anchorName)
    if (!key) continue
    const hit = counts.get(key)
    if (hit) {
      hit.count += 1
    } else {
      counts.set(key, { displayName: row.anchorName, count: 1 })
    }
  }
  for (const { displayName, count } of counts.values()) {
    if (count > 1) {
      warnings.push(`${displayName} 当天出现 ${count} 条生效排班，请检查人工与默认模板是否重复。`)
    }
  }
}

/**
 * 合并人工 / 默认 / 模板补齐排班：
 * - 完整人工日：仅人工
 * - 部分人工：人工优先 + 未冲突的默认/模板补齐
 */
export function buildEffectiveScheduleRowsForDate(params: {
  dateKey: string
  dateConfirmed: boolean
  dbRows: DbScheduleRowLike[]
  templates: ScheduleTemplateSeed[]
  templateRecords?: Array<{
    id: string
    anchorId?: string | null
    anchorName: string
    shopName: string
    liveRoomName: string
    startTime: string
    endTime: string
    effectiveFrom: string | null
    effectiveTo: string | null
    enabled: boolean
    sortOrder: number
    note: string | null
    createdAt: Date
    updatedAt: Date
  }>
}): BuildEffectiveScheduleRowsResult {
  const warnings: string[] = []
  const { dateKey, dateConfirmed, dbRows, templates } = params

  const manualRows = dbRows.filter((r) => r.source === 'manual' && r.enabled)
  const generatedRows = dbRows.filter((r) => r.source === 'generated_default' && r.enabled)
  const expectedTemplateCount = templates.length

  if (manualCoversFullBusinessDay(manualRows, expectedTemplateCount)) {
    const rows = manualRows
      .map((r) => dbRowToEffective(r, 'manual', dateConfirmed))
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
    return {
      rows,
      warnings,
      sourceSummary: {
        manualCount: rows.length,
        generatedCount: 0,
        virtualCount: 0,
      },
    }
  }

  const occupiedRows: ScheduleOverlapInterval[] = [
    ...manualRows.map(occupiedIntervalFromDbRow),
    ...generatedRows.map(occupiedIntervalFromDbRow),
  ]

  const rawTemplateInputs =
    params.templateRecords ??
    templates.map((t, i) => ({
      id: `virtual-seed-${i}`,
      anchorId: null as string | null,
      anchorName: t.anchorName,
      shopName: t.shopName,
      liveRoomName: t.liveRoomName,
      startTime: t.startTime,
      endTime: t.endTime,
      effectiveFrom: t.effectiveFrom,
      effectiveTo: t.effectiveTo,
      enabled: true,
      sortOrder: t.sortOrder,
      note: t.note ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  const templateInputs = rawTemplateInputs.map((t) => ({
    ...t,
    anchorId: t.anchorId ?? null,
  }))

  const allVirtual = buildVirtualSchedulesFromTemplates(dateKey, templateInputs)

  const skippedByOccupiedAnchor: typeof allVirtual = []
  const eligibleVirtual = allVirtual.filter((v) => {
    const hasManual = manualRows.some((m) => anchorNamesMatch(m.anchorName, v.anchorName))
    const hasGenerated = generatedRows.some((g) => anchorNamesMatch(g.anchorName, v.anchorName))
    if (hasManual || hasGenerated) {
      skippedByOccupiedAnchor.push(v)
      return false
    }
    return true
  })

  for (const v of skippedByOccupiedAnchor) {
    const hasManual = manualRows.some((m) => anchorNamesMatch(m.anchorName, v.anchorName))
    if (hasManual) {
      warnings.push(
        `${v.anchorName} 已有人工排班，默认模板 ${v.liveRoomName} ${hmFromDate(v.startAt, dateKey)}-${hmFromDate(v.endAt, dateKey)} 已跳过。`,
      )
    } else {
      warnings.push(
        `${v.anchorName} 当天已有默认排班，模板 ${v.liveRoomName} ${hmFromDate(v.startAt, dateKey)}-${hmFromDate(v.endAt, dateKey)} 已跳过。`,
      )
    }
  }

  const filtered = filterVirtualSchedulesAgainstOccupied(eligibleVirtual, occupiedRows)

  for (const v of filtered.skipped) {
    warnings.push(
      `${v.liveRoomName} ${hmFromDate(v.startAt, dateKey)}-${hmFromDate(v.endAt, dateKey)} 模板与当天排班冲突，未参与业绩计算。`,
    )
  }

  const effectiveRows: EffectiveScheduleRow[] = [
    ...manualRows.map((r) => dbRowToEffective(r, 'manual', dateConfirmed)),
    ...generatedRows.map((r) => dbRowToEffective(r, 'generated_default', dateConfirmed)),
    ...filtered.kept.map((v) => ({
      rowId: v.id,
      source: 'virtual_template' as const,
      anchorName: v.anchorName,
      shopName: v.shopName,
      liveRoomName: v.liveRoomName,
      startTime: hmFromDate(v.startAt, dateKey),
      endTime: hmFromDate(v.endAt, dateKey),
      startAt: v.startAt.toISOString(),
      endAt: v.endAt.toISOString(),
      enabled: true,
      confirmed: dateConfirmed,
      note: v.note ?? '系统模板补齐',
    })),
  ].sort((a, b) => a.startAt.localeCompare(b.startAt))

  warnDuplicateAnchorsInEffectiveRows(effectiveRows, warnings)

  return {
    rows: effectiveRows,
    warnings,
    sourceSummary: {
      manualCount: effectiveRows.filter((r) => r.source === 'manual').length,
      generatedCount: effectiveRows.filter((r) => r.source === 'generated_default').length,
      virtualCount: effectiveRows.filter((r) => r.source === 'virtual_template').length,
    },
  }
}
