/**
 * 强制整理 2026-07-11 为用户确认的四场临时调班（禁用冲突旧行）
 * npx tsx apps/server/scripts/repair-confirm-20260711-temp-schedule.ts --apply --force-clean
 */
import { prisma } from '../src/lib/prisma'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'
import { invalidateBusinessBoardCacheForDate } from '../src/services/anchor-schedule-cache.service'
import { clearCanonicalAttributionCache } from '../src/services/canonical-order-attribution.service'

const DATE = '2026-07-11'
const NOTE = '2026-07-11 人工确认临时调班'
const CONFIRM_BY = 'system-repair'
const CONFIRM_NOTE =
  '用户确认真实临时调班：子杰拾玉居早场；小白和田雅玉早场09:30-14:00；小红和田雅玉下午场14:00-18:30；小艺XY下午场14:00-18:30'

const TARGET = [
  {
    anchorName: '子杰',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '09:30',
    endTime: '14:00',
  },
  {
    anchorName: '小白',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '09:30',
    endTime: '14:00',
  },
  {
    anchorName: '小红',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '14:00',
    endTime: '18:30',
  },
  {
    anchorName: '小艺',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '14:00',
    endTime: '18:30',
  },
] as const

/** 晚场保留 */
const KEEP_EVENING = [{ shopName: '拾玉居和田玉', startTime: '18:30', anchorName: '飞云' }] as const

function hm(d: Date): string {
  return d.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const forceClean = process.argv.includes('--force-clean')
  const existing = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: DATE },
    orderBy: { startAt: 'asc' },
  })
  console.log(JSON.stringify({ phase: 'before', count: existing.length, rows: existing.map((r) => ({
    id: r.id,
    anchorName: r.anchorName,
    shopName: r.shopName,
    start: hm(r.startAt),
    end: hm(r.endAt),
    enabled: r.enabled,
    confirmed: r.confirmed,
    note: r.note,
  })) }, null, 2))

  if (!apply) {
    console.log('dry-run only; pass --apply --force-clean')
    return
  }

  const now = new Date()
  const targetIds = new Set<string>()

  for (const t of TARGET) {
    const bounds = buildScheduleBounds(DATE, t.startTime, t.endTime)
    const hit = existing.find(
      (r) =>
        r.shopName === t.shopName &&
        r.anchorName === t.anchorName &&
        Math.abs(r.startAt.getTime() - bounds.startAt.getTime()) < 5 * 60_000,
    )
    if (hit) {
      await prisma.anchorDailySchedule.update({
        where: { id: hit.id },
        data: {
          liveRoomName: t.liveRoomName,
          startAt: bounds.startAt,
          endAt: bounds.endAt,
          confirmed: true,
          confirmedAt: now,
          confirmedBy: CONFIRM_BY,
          confirmNote: CONFIRM_NOTE,
          note: NOTE,
          enabled: true,
          source: 'manual',
        },
      })
      targetIds.add(hit.id)
      console.log(JSON.stringify({ updated: hit.id, ...t }))
    } else {
      const created = await prisma.anchorDailySchedule.create({
        data: {
          scheduleDate: DATE,
          anchorName: t.anchorName,
          shopName: t.shopName,
          liveRoomName: t.liveRoomName,
          startAt: bounds.startAt,
          endAt: bounds.endAt,
          source: 'manual',
          confirmed: true,
          confirmedAt: now,
          confirmedBy: CONFIRM_BY,
          confirmNote: CONFIRM_NOTE,
          note: NOTE,
          enabled: true,
        },
      })
      targetIds.add(created.id)
      console.log(JSON.stringify({ created: created.id, ...t }))
    }
  }

  if (forceClean) {
    const after = await prisma.anchorDailySchedule.findMany({ where: { scheduleDate: DATE } })
    for (const r of after) {
      if (targetIds.has(r.id)) continue
      const isEveningKeep = KEEP_EVENING.some(
        (k) => k.shopName === r.shopName && k.anchorName === r.anchorName && hm(r.startAt) === k.startTime,
      )
      if (isEveningKeep) {
        // ensure evening stays enabled/confirmed
        if (!r.enabled) {
          await prisma.anchorDailySchedule.update({
            where: { id: r.id },
            data: { enabled: true },
          })
        }
        continue
      }
      // disable any other same-day row that overlaps a target shop window or is extra morning/afternoon
      const overlapsTarget = TARGET.some((t) => {
        const bounds = buildScheduleBounds(DATE, t.startTime, t.endTime)
        return (
          r.shopName === t.shopName &&
          overlaps(r.startAt.getTime(), r.endAt.getTime(), bounds.startAt.getTime(), bounds.endAt.getTime())
        )
      })
      if (overlapsTarget || r.shopName === '和田雅玉' || r.shopName === 'XY祥钰珠宝' || r.shopName === '拾玉居和田玉') {
        // keep non-overlapping evening already handled; disable leftover day slots
        if (hm(r.startAt) >= '18:30' && r.shopName === '拾玉居和田玉') continue
        await prisma.anchorDailySchedule.update({
          where: { id: r.id },
          data: {
            enabled: false,
            note: `${r.note ?? ''}|被0711临时调班强制整理禁用`.replace(/^\|/, ''),
          },
        })
        console.log(JSON.stringify({ disabled: r.id, anchorName: r.anchorName, shopName: r.shopName, start: hm(r.startAt) }))
      }
    }
  }

  clearCanonicalAttributionCache()
  await invalidateBusinessBoardCacheForDate(DATE)

  const finalRows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: DATE, enabled: true },
    orderBy: { startAt: 'asc' },
  })
  console.log(JSON.stringify({
    phase: 'after',
    count: finalRows.length,
    rows: finalRows.map((r) => ({
      id: r.id,
      anchorName: r.anchorName,
      shopName: r.shopName,
      start: hm(r.startAt),
      end: hm(r.endAt),
      confirmed: r.confirmed,
      note: r.note,
      confirmNote: r.confirmNote,
    })),
  }, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
