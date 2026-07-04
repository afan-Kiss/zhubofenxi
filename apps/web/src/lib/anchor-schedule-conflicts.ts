export interface ScheduleRowDraft {
  anchorName: string
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  enabled?: boolean
}

export interface ScheduleConflict {
  type: 'shop_overlap' | 'anchor_overlap'
  message: string
  rowIndexes: number[]
}

const HM_RE = /^(\d{1,2}):(\d{2})$/

function parseHmToMinutes(hm: string): number {
  const m = HM_RE.exec(hm.trim())
  if (!m) return NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h === 24 && min === 0) return 24 * 60
  return h * 60 + min
}

function formatMinutesToHm(totalMinutes: number): string {
  if (totalMinutes >= 24 * 60) return '24:00'
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatIntervalRange(startTime: string, endTime: string): string {
  return `${startTime}-${endTime === '23:59' ? '24:00' : endTime}`
}

function roomLabel(row: ScheduleRowDraft): string {
  return row.liveRoomName.trim() || row.shopName.trim()
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA
}

function rowInterval(row: ScheduleRowDraft): { start: number; end: number } | null {
  const start = parseHmToMinutes(row.startTime)
  let end = parseHmToMinutes(row.endTime === '23:59' ? '24:00' : row.endTime)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  if (end === 0 && row.endTime.trim() === '24:00') end = 24 * 60
  if (start >= end && row.endTime.trim() !== '24:00') return null
  return { start, end }
}

function sameShop(a: ScheduleRowDraft, b: ScheduleRowDraft): boolean {
  return `${a.shopName}::${a.liveRoomName}` === `${b.shopName}::${b.liveRoomName}`
}

export function validateScheduleRows(rows: ScheduleRowDraft[]): {
  fieldErrors: string[]
  conflicts: ScheduleConflict[]
} {
  const fieldErrors: string[] = []
  const enabled = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.enabled !== false)

  for (const { row, index } of enabled) {
    if (!row.startTime?.trim()) fieldErrors.push(`第 ${index + 1} 行开始时间不能为空`)
    if (!row.endTime?.trim()) fieldErrors.push(`第 ${index + 1} 行结束时间不能为空`)
    if (!row.anchorName?.trim()) fieldErrors.push(`第 ${index + 1} 行主播不能为空`)
    if (!row.shopName?.trim() || !row.liveRoomName?.trim()) {
      fieldErrors.push(`第 ${index + 1} 行店铺/直播间不能为空`)
    }
    const iv = rowInterval(row)
    if (iv && iv.start === iv.end && row.endTime.trim() !== '24:00') {
      fieldErrors.push(`第 ${index + 1} 行开始时间不能等于结束时间`)
    }
  }

  const conflicts: ScheduleConflict[] = []

  const anchorGroups = new Map<string, Array<{ row: ScheduleRowDraft; index: number }>>()
  for (const item of enabled) {
    const key = item.row.anchorName.trim()
    if (!key) continue
    if (!anchorGroups.has(key)) anchorGroups.set(key, [])
    anchorGroups.get(key)!.push(item)
  }

  for (const [anchorName, group] of anchorGroups) {
    if (group.length <= 1) continue
    conflicts.push({
      type: 'anchor_overlap',
      message: `${anchorName}今天已经有一条排班了，不能再给她排第二场`,
      rowIndexes: group.map((g) => g.index),
    })
  }

  const intervals = enabled
    .map(({ row, index }) => ({ row, index, iv: rowInterval(row) }))
    .filter((item): item is { row: ScheduleRowDraft; index: number; iv: { start: number; end: number } } =>
      Boolean(item.iv),
    )

  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i]!
      const b = intervals[j]!
      if (!intervalsOverlap(a.iv.start, a.iv.end, b.iv.start, b.iv.end)) continue

      const aStart = formatMinutesToHm(a.iv.start)
      const aEnd = formatMinutesToHm(a.iv.end)
      const bStart = formatMinutesToHm(b.iv.start)
      const bEnd = formatMinutesToHm(b.iv.end)
      const aRange = formatIntervalRange(aStart, aEnd)
      const bRange = formatIntervalRange(bStart, bEnd)

      if (a.row.anchorName.trim() === b.row.anchorName.trim()) continue

      if (sameShop(a.row, b.row)) {
        conflicts.push({
          type: 'shop_overlap',
          message: `${roomLabel(a.row)} ${bRange} 已经排了${b.row.anchorName.trim()}，不能再排其他主播`,
          rowIndexes: [a.index, b.index],
        })
      }
    }
  }

  return { fieldErrors, conflicts }
}

export function conflictIndexes(conflicts: ScheduleConflict[]): Set<number> {
  const set = new Set<number>()
  for (const c of conflicts) {
    for (const idx of c.rowIndexes) set.add(idx)
  }
  return set
}

export function rowConflictMessages(index: number, conflicts: ScheduleConflict[]): string[] {
  return conflicts.filter((c) => c.rowIndexes.includes(index)).map((c) => c.message)
}
