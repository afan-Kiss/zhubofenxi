/**
 * 修正线上 2026-07-01 manual 排班为新固定规则。
 *
 * 用法:
 *   npx tsx apps/server/scripts/repair-manual-schedule-20260701.ts          # 只读查询
 *   npx tsx apps/server/scripts/repair-manual-schedule-20260701.ts --apply  # 执行修正
 */
import { prisma } from '../src/lib/prisma'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'
import { confirmDailySchedules } from '../src/services/anchor-schedule-confirm.service'
import { invalidateBusinessBoardCacheForDate } from '../src/services/anchor-schedule-cache.service'

const TARGET_DATE = '2026-07-01'
const SCRIPT_TAG = 'repair-manual-schedule-20260701'

const TARGET_ROWS = [
  {
    anchorName: '子杰',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '09:30',
    endTime: '14:00',
    note: '早场·拾玉居和田玉',
  },
  {
    anchorName: '小红',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '09:30',
    endTime: '14:00',
    note: '早场·和田雅玉',
  },
  {
    anchorName: '小白',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '14:00',
    endTime: '18:30',
    note: '午场·XY祥钰珠宝',
  },
  {
    anchorName: '小艺',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '14:00',
    endTime: '18:30',
    note: '午场·和田雅玉',
  },
  {
    anchorName: '飞云',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '18:30',
    endTime: '23:00',
    note: '晚场·拾玉居和田玉',
  },
] as const

type ManualRow = Awaited<ReturnType<typeof loadManualRows>>[number]

function formatHm(d: Date): string {
  const endDateKey = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const isMidnightEnd =
    d.getHours() === 0 && d.getMinutes() === 0 && endDateKey > TARGET_DATE
  if (isMidnightEnd) return '24:00'
  return d.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function printManualRows(label: string, rows: ManualRow[]) {
  console.log(`[${SCRIPT_TAG}] ${label} (${rows.length} rows):`)
  if (rows.length === 0) {
    console.log('  (none)')
    return
  }
  for (const row of rows) {
    console.log(
      [
        `id=${row.id}`,
        `date=${row.scheduleDate}`,
        `anchor=${row.anchorName}`,
        `shop=${row.shopName}`,
        `room=${row.liveRoomName}`,
        `startAt=${row.startAt.toISOString()}`,
        `endAt=${row.endAt.toISOString()}`,
        `time=${formatHm(row.startAt)}-${formatHm(row.endAt)}`,
        `source=${row.source}`,
        `enabled=${row.enabled}`,
        `confirmed=${row.confirmed}`,
        `note=${row.note ?? ''}`,
      ].join(' | '),
    )
  }
}

async function loadManualRows() {
  return prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: TARGET_DATE, source: 'manual' },
    orderBy: [{ anchorName: 'asc' }, { startAt: 'asc' }],
  })
}

function rowMatchesTarget(row: ManualRow, target: (typeof TARGET_ROWS)[number]): boolean {
  if (row.anchorName !== target.anchorName) return false
  if (row.shopName !== target.shopName) return false
  if (row.liveRoomName !== target.liveRoomName) return false
  if (!row.enabled) return false
  const startTime = formatHm(row.startAt)
  const endTime = formatHm(row.endAt)
  if (startTime !== target.startTime || endTime !== target.endTime) return false
  if ((row.note ?? '').trim() !== target.note) return false
  return true
}

function needsRepair(rows: ManualRow[]): boolean {
  for (const target of TARGET_ROWS) {
    const matched = rows.filter((row) => rowMatchesTarget(row, target))
    if (matched.length !== 1) return true
  }
  const enabledRows = rows.filter((row) => row.enabled)
  if (enabledRows.length !== TARGET_ROWS.length) return true
  return false
}

function pickPrimaryRow(rows: ManualRow[], anchorName: string): ManualRow | undefined {
  const candidates = rows.filter((row) => row.anchorName === anchorName)
  if (candidates.length === 0) return undefined
  return (
    candidates.find((row) => row.enabled && row.confirmed) ??
    candidates.find((row) => row.enabled) ??
    candidates[0]
  )
}

async function applyRepair(rows: ManualRow[]) {
  const actions: string[] = []

  for (const target of TARGET_ROWS) {
    const { startAt, endAt } = buildScheduleBounds(
      TARGET_DATE,
      target.startTime,
      target.endTime,
    )
    const anchorRows = rows.filter((row) => row.anchorName === target.anchorName)
    const primary = pickPrimaryRow(rows, target.anchorName)

    if (primary) {
      await prisma.anchorDailySchedule.update({
        where: { id: primary.id },
        data: {
          shopName: target.shopName,
          liveRoomName: target.liveRoomName,
          startAt,
          endAt,
          enabled: true,
          note: target.note,
          source: 'manual',
        },
      })
      actions.push(`update ${target.anchorName} id=${primary.id}`)

      for (const extra of anchorRows) {
        if (extra.id === primary.id) continue
        await prisma.anchorDailySchedule.update({
          where: { id: extra.id },
          data: {
            enabled: false,
            note: `${extra.note ?? ''} [disabled by ${SCRIPT_TAG}: duplicate old manual row]`.trim(),
          },
        })
        actions.push(
          `disable duplicate ${target.anchorName} id=${extra.id} time=${formatHm(extra.startAt)}-${formatHm(extra.endAt)}`,
        )
      }
    } else {
      const created = await prisma.anchorDailySchedule.create({
        data: {
          scheduleDate: TARGET_DATE,
          anchorName: target.anchorName,
          shopName: target.shopName,
          liveRoomName: target.liveRoomName,
          startAt,
          endAt,
          source: 'manual',
          enabled: true,
          locked: false,
          confirmed: false,
          note: target.note,
          createdBy: SCRIPT_TAG,
        },
      })
      actions.push(`create ${target.anchorName} id=${created.id}`)
    }
  }

  const confirm = await confirmDailySchedules({
    date: TARGET_DATE,
    confirmedBy: SCRIPT_TAG,
    confirmNote: 'manual schedule repaired to 20260701 fixed rules',
  })
  actions.push(`confirm date=${confirm.date} count=${confirm.scheduleCount}`)

  await invalidateBusinessBoardCacheForDate(TARGET_DATE)
  actions.push(`invalidate cache ${TARGET_DATE}`)

  return actions
}

async function main() {
  const apply = process.argv.includes('--apply')
  const before = await loadManualRows()
  printManualRows('before', before)

  const repairNeeded = needsRepair(before)
  if (!repairNeeded) {
    console.log(`[${SCRIPT_TAG}] 无需修正：2026-07-01 manual 排班已符合新规则`)
    return
  }

  console.log(`[${SCRIPT_TAG}] 检测到需要修正`)
  const extras = before.filter((row) => {
    const target = TARGET_ROWS.find((t) => t.anchorName === row.anchorName)
    if (!target) return true
    return !rowMatchesTarget(row, target)
  })
  if (extras.length > 0) {
    console.log(`[${SCRIPT_TAG}] 非目标/重复 manual 行:`)
    for (const row of extras) {
      console.log(
        `  id=${row.id} anchor=${row.anchorName} time=${formatHm(row.startAt)}-${formatHm(row.endAt)} enabled=${row.enabled}`,
      )
    }
  }

  if (!apply) {
    console.log(`[${SCRIPT_TAG}] 只读模式；加 --apply 执行修正`)
    return
  }

  const actions = await applyRepair(before)
  console.log(`[${SCRIPT_TAG}] actions:`)
  for (const action of actions) {
    console.log(`  ${action}`)
  }

  const after = await loadManualRows()
  printManualRows('after', after)

  if (needsRepair(after.filter((row) => row.enabled))) {
    throw new Error(`[${SCRIPT_TAG}] after 校验失败：enabled manual 仍不符合新规则`)
  }

  console.log(`[${SCRIPT_TAG}] OK`)
}

main()
  .catch((err) => {
    console.error('[repair-manual-schedule-20260701] FAIL', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
