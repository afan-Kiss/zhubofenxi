import type { AnchorConfig, ExcelParseResult, FieldMappingResult, LiveSession } from '../types/analysis'
import { findAnchorByName } from './anchor-rules.service'
import { formatDateTime, parseDateTime } from '../utils/time'

function getMappedHeader(mapping: FieldMappingResult, key: string): string | null {
  return mapping.mappings.find((m) => m.key === key)?.header ?? null
}

export function normalizeLiveSessions(
  parsed: ExcelParseResult,
  mapping: FieldMappingResult,
  config: AnchorConfig,
): { sessions: LiveSession[]; warnings: string[] } {
  const warnings: string[] = [...mapping.warnings]
  const startHeader = getMappedHeader(mapping, 'liveStart')
  const endHeader = getMappedHeader(mapping, 'liveEnd')
  const anchorHeader = getMappedHeader(mapping, 'anchor')

  if (!startHeader || !endHeader) {
    return { sessions: [], warnings }
  }

  const sessions: LiveSession[] = []

  parsed.rows.forEach((row, idx) => {
    const sourceRowIndex = idx + 2
    const startParsed = parseDateTime(row[startHeader])
    const endParsed = parseDateTime(row[endHeader])
    if (!startParsed.ok || !endParsed.ok) return

    let startTime = startParsed.date
    let endTime = endParsed.date
    if (endTime.getTime() < startTime.getTime()) {
      endTime = new Date(endTime.getTime() + 86400000)
    }

    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000)

    let anchorName: string | undefined
    let anchorId: string | undefined
    if (anchorHeader) {
      const name = String(row[anchorHeader] ?? '').trim()
      if (name) {
        anchorName = name
        const found = findAnchorByName(config, name)
        if (found) anchorId = found.id
      }
    }

    sessions.push({
      id: `live-${sourceRowIndex}`,
      sourceRowIndex,
      startTime,
      endTime,
      startTimeText: formatDateTime(startTime),
      endTimeText: formatDateTime(endTime),
      anchorName,
      anchorId,
      durationMinutes,
      errors: [],
      raw: row,
    })
  })

  return { sessions, warnings }
}

export function findBestLiveSession(
  orderTime: Date | null,
  sessions: LiveSession[],
): LiveSession | null {
  if (!orderTime || !sessions.length) return null
  const t = orderTime.getTime()
  const matched = sessions.filter(
    (s) => t >= s.startTime.getTime() && t <= s.endTime.getTime(),
  )
  if (!matched.length) return null
  matched.sort((a, b) => a.durationMinutes - b.durationMinutes)
  return matched[0]
}
