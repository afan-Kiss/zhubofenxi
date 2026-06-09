import type { FieldMappingResult } from '../types/fieldMapping'
import type { ImportedExcelFile } from '../types/import'
import type { LiveSession } from '../types/anchor'
import { extractDataRowsFromFile } from './excelRows'
import { findAnchorByName } from './anchorRules'
import type { AnchorConfig } from '../types/anchor'
import { formatDateTime, parseDateTime } from './time'

function getMappedHeader(mapping: FieldMappingResult, key: string): string | null {
  return mapping.mappings.find((m) => m.key === key)?.header ?? null
}

function cellValue(row: Record<string, unknown>, header: string | null): unknown {
  if (!header) return undefined
  return row[header]
}

export interface LiveSessionNormalizeResult {
  sessions: LiveSession[]
  abnormalSessions: LiveSession[]
  warnings: string[]
}

export function normalizeLiveSessions(
  liveFile: ImportedExcelFile | undefined,
  liveMapping: FieldMappingResult | null,
  config: AnchorConfig,
): LiveSessionNormalizeResult {
  const warnings: string[] = []
  if (!liveFile || !liveMapping) {
    return { sessions: [], abnormalSessions: [], warnings }
  }

  const extracted = extractDataRowsFromFile(liveFile)
  if (!extracted) {
    return { sessions: [], abnormalSessions: [], warnings: ['直播场次表无法解析'] }
  }

  const startHeader = getMappedHeader(liveMapping, 'liveStart')
  const endHeader = getMappedHeader(liveMapping, 'liveEnd')
  const anchorHeader = getMappedHeader(liveMapping, 'anchor')

  if (!startHeader || !endHeader) {
    warnings.push('直播场次表缺少开始/结束时间字段，将仅使用时间规则归属')
    return { sessions: [], abnormalSessions: [], warnings }
  }

  const sessions: LiveSession[] = []
  const abnormalSessions: LiveSession[] = []

  extracted.dataRows.forEach((row, idx) => {
    const sourceRowIndex = extracted.headerRowIndex + 1 + idx
    const errors: string[] = []

    const startParsed = parseDateTime(cellValue(row, startHeader))
    const endParsed = parseDateTime(cellValue(row, endHeader))

    if (!startParsed.ok) errors.push(`开始时间：${startParsed.error}`)
    if (!endParsed.ok) errors.push(`结束时间：${endParsed.error}`)

    if (!startParsed.ok || !endParsed.ok) {
      abnormalSessions.push({
        id: `live-abnormal-${sourceRowIndex}`,
        sourceRowIndex,
        startTime: startParsed.ok ? startParsed.date : new Date(0),
        endTime: endParsed.ok ? endParsed.date : new Date(0),
        startTimeText: startParsed.ok ? formatDateTime(startParsed.date) : '—',
        endTimeText: endParsed.ok ? formatDateTime(endParsed.date) : '—',
        durationMinutes: 0,
        errors,
        raw: row,
      })
      return
    }

    let startTime = startParsed.date
    let endTime = endParsed.date
    if (endTime.getTime() < startTime.getTime()) {
      endTime = new Date(endTime.getTime() + 86400000)
    }

    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000)

    let anchorName: string | undefined
    let anchorId: string | undefined
    if (anchorHeader) {
      const name = String(cellValue(row, anchorHeader) ?? '').trim()
      if (name) {
        anchorName = name
        const found = findAnchorByName(config, name)
        if (found) {
          anchorId = found.id
        } else {
          warnings.push(`直播场次出现未知主播「${name}」，分析时将临时纳入统计`)
        }
      }
    }

    const session: LiveSession = {
      id: `live-${sourceRowIndex}`,
      sourceRowIndex,
      startTime,
      endTime,
      startTimeText: formatDateTime(startTime),
      endTimeText: formatDateTime(endTime),
      anchorName,
      anchorId,
      durationMinutes,
      errors,
      raw: row,
    }

    if (errors.length) abnormalSessions.push(session)
    else sessions.push(session)
  })

  return { sessions, abnormalSessions, warnings }
}
