/**
 * 一次性：确认默认排班模板 + 写入 2026-07-04 手动排班
 * 用法: npx tsx apps/server/scripts/reinit-anchor-schedules.ts
 */
import { prisma } from '../src/lib/prisma'
import {
  NEW_SCHEDULE_TEMPLATE_SEEDS_20260701,
  NEW_SCHEDULE_START_DATE,
  repairScheduleTemplatesFrom20260701,
  templateAppliesOnDate,
} from '../src/services/anchor-schedule-template.service'
import {
  getEffectiveScheduleTableForDate,
  saveDailySchedules,
} from '../src/services/anchor-daily-schedule.service'

const MANUAL_DATE = '2026-07-04'
const NEXT_DATE = '2026-07-05'
const CREATED_BY = 'reinit-anchor-schedules'

const MANUAL_SCHEDULES_20260704 = [
  {
    anchorName: '子杰',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '09:30',
    endTime: '14:00',
    note: '7.4 手动·早场·拾玉居',
  },
  {
    anchorName: '小红',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '14:15',
    endTime: '18:30',
    note: '7.4 手动·午场·XY祥钰',
  },
  {
    anchorName: '小艺',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '14:10',
    endTime: '18:10',
    note: '7.4 手动·午场·和田雅玉',
  },
  {
    anchorName: '飞云',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '18:30',
    endTime: '23:40',
    note: '7.4 手动·晚场·拾玉居',
  },
]

async function assertDefaultTemplates(): Promise<void> {
  const rows = await prisma.anchorScheduleTemplate.findMany({ orderBy: { sortOrder: 'asc' } })
  const active = rows.filter((row) =>
    templateAppliesOnDate(
      {
        anchorName: row.anchorName,
        shopName: row.shopName,
        liveRoomName: row.liveRoomName,
        startTime: row.startTime,
        endTime: row.endTime,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        sortOrder: row.sortOrder,
      },
      NEW_SCHEDULE_START_DATE,
    ),
  )

  if (active.length !== NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.length) {
    throw new Error(
      `默认模板数量不符：期望 ${NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.length}，实际 ${active.length}`,
    )
  }

  for (const seed of NEW_SCHEDULE_TEMPLATE_SEEDS_20260701) {
    const hit = active.find(
      (row) =>
        row.anchorName === seed.anchorName &&
        row.shopName === seed.shopName &&
        row.startTime === seed.startTime &&
        row.endTime === seed.endTime,
    )
    if (!hit) {
      throw new Error(`缺少默认模板: ${seed.anchorName} ${seed.shopName} ${seed.startTime}-${seed.endTime}`)
    }
  }
}

async function main(): Promise<void> {
  console.log('[reinit-anchor-schedules] repair default templates from 2026-07-01')
  const repairResult = await repairScheduleTemplatesFrom20260701({ dryRun: false })
  console.log('[reinit-anchor-schedules] repair result', JSON.stringify(repairResult))
  await assertDefaultTemplates()
  console.log('[reinit-anchor-schedules] default 5 templates OK')

  console.log(`[reinit-anchor-schedules] save manual schedules for ${MANUAL_DATE}`)
  const saved = await saveDailySchedules({
    date: MANUAL_DATE,
    schedules: MANUAL_SCHEDULES_20260704,
    createdBy: CREATED_BY,
    confirm: true,
  })
  console.log(`[reinit-anchor-schedules] saved ${saved.schedules.length} manual rows`)

  const manualDay = await getEffectiveScheduleTableForDate(MANUAL_DATE)
  const manualRows = manualDay.rows.filter((r) => r.source === 'manual')
  if (manualRows.length !== 4) {
    throw new Error(`2026-07-04 应有 4 条 manual，实际 ${manualRows.length}`)
  }

  const nextDay = await getEffectiveScheduleTableForDate(NEXT_DATE)
  const virtualRows = nextDay.rows.filter((r) => r.source === 'virtual_template')
  if (virtualRows.length !== 5) {
    throw new Error(`2026-07-05 应有 5 条 virtual_template，实际 ${virtualRows.length}`)
  }

  console.log(`[reinit-anchor-schedules] ${MANUAL_DATE} effective:`)
  for (const row of manualDay.rows) {
    console.log(
      JSON.stringify({
        source: row.source,
        anchorName: row.anchorName,
        shopName: row.shopName,
        startTime: row.startTime,
        endTime: row.endTime,
      }),
    )
  }

  console.log(`[reinit-anchor-schedules] ${NEXT_DATE} effective:`)
  for (const row of nextDay.rows) {
    console.log(
      JSON.stringify({
        source: row.source,
        anchorName: row.anchorName,
        shopName: row.shopName,
        startTime: row.startTime,
        endTime: row.endTime,
      }),
    )
  }

  console.log('[reinit-anchor-schedules] OK')
}

main()
  .catch((err) => {
    console.error('[reinit-anchor-schedules] FAILED', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
