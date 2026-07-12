/**
 * 确认 2026-07-11 合法临时调班（用户确认真实排班）
 *
 * 用法:
 *   npx tsx apps/server/scripts/repair-confirm-20260711-temp-schedule.ts
 *   npx tsx apps/server/scripts/repair-confirm-20260711-temp-schedule.ts --apply
 */
import { prisma } from '../src/lib/prisma'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'
import { invalidateBusinessBoardCacheForDate } from '../src/services/anchor-schedule-cache.service'
import { clearCanonicalAttributionCache } from '../src/services/canonical-order-attribution.service'

const DATE = '2026-07-11'
const NOTE = '2026-07-11 人工确认临时调班'
const CONFIRM_BY = 'system-repair'
const CONFIRM_NOTE = '用户确认真实临时调班：子杰拾玉居早场；小白和田雅玉早场；小红和田雅玉下午场；小艺XY下午场'

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

function hm(d: Date): string {
  return d.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const existing = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: DATE, enabled: true },
    orderBy: { startAt: 'asc' },
  })
  console.log(`[0711] 当前排班 ${existing.length} 条:`)
  for (const r of existing) {
    console.log(
      `  ${r.anchorName} | ${r.shopName} | ${hm(r.startAt)}-${hm(r.endAt)} | confirmed=${r.confirmed} | note=${r.note ?? ''}`,
    )
  }

  if (!apply) {
    console.log('\n只读模式。加 --apply 写入确认与备注，并失效缓存。')
    return
  }

  const now = new Date()
  // 先禁用当日全部，再 upsert 目标四场（保留晚场等其他已确认场次时更稳妥：仅更新目标）
  for (const t of TARGET) {
    const bounds = buildScheduleBounds(DATE, t.startTime, t.endTime)
    const hit = existing.find(
      (r) =>
        r.shopName === t.shopName &&
        Math.abs(r.startAt.getTime() - bounds.startAt.getTime()) < 60_000 &&
        Math.abs(r.endAt.getTime() - bounds.endAt.getTime()) < 60_000,
    )
    if (hit) {
      await prisma.anchorDailySchedule.update({
        where: { id: hit.id },
        data: {
          anchorName: t.anchorName,
          liveRoomName: t.liveRoomName,
          startAt: bounds.startAt,
          endAt: bounds.endAt,
          confirmed: true,
          confirmedAt: now,
          confirmedBy: CONFIRM_BY,
          confirmNote: CONFIRM_NOTE,
          note: NOTE,
          enabled: true,
        },
      })
      console.log(`  updated ${hit.id} → ${t.anchorName}@${t.shopName}`)
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
      console.log(`  created ${created.id} → ${t.anchorName}@${t.shopName}`)
    }
  }

  // 清理与目标冲突的同店同时段其他主播
  const after = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: DATE, enabled: true },
  })
  for (const r of after) {
    const isTarget = TARGET.some(
      (t) =>
        t.anchorName === r.anchorName &&
        t.shopName === r.shopName &&
        hm(r.startAt) === t.startTime,
    )
    if (isTarget) continue
    // 同店同开始时间但主播不同 → 禁用
    const conflict = TARGET.find(
      (t) => t.shopName === r.shopName && hm(r.startAt) === t.startTime && t.anchorName !== r.anchorName,
    )
    if (conflict) {
      await prisma.anchorDailySchedule.update({
        where: { id: r.id },
        data: { enabled: false, note: `${r.note ?? ''}|被0711临时调班替换`.trim() },
      })
      console.log(`  disabled conflict ${r.id} ${r.anchorName}@${r.shopName}`)
    }
  }

  clearCanonicalAttributionCache()
  await invalidateBusinessBoardCacheForDate(DATE)
  const finalRows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: DATE, enabled: true },
    orderBy: { startAt: 'asc' },
  })
  console.log('\n[0711] 最终排班:')
  for (const r of finalRows) {
    console.log(
      `  ${r.anchorName} | ${r.shopName} | ${hm(r.startAt)}-${hm(r.endAt)} | confirmed=${r.confirmed} | note=${r.note ?? ''}`,
    )
  }
  console.log('DONE')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
