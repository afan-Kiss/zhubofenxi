/**
 * 修复 2026-07-01 起默认排班模板，并清理旧 generated_default 行。
 * 用法: npx tsx apps/server/scripts/repair-schedule-templates-20260701.ts [--dry-run]
 */
import { prisma } from '../src/lib/prisma'
import {
  DEFAULT_SCHEDULE_TEMPLATE_SEEDS,
  NEW_SCHEDULE_START_DATE,
  NEW_SCHEDULE_TEMPLATE_SEEDS_20260701,
  repairScheduleTemplatesFrom20260701,
  templateAppliesOnDate,
} from '../src/services/anchor-schedule-template.service'

function formatTemplateRow(row: {
  anchorName: string
  shopName: string
  startTime: string
  endTime: string
  effectiveFrom: string | null
  effectiveTo: string | null
  enabled: boolean
  note: string | null
}): string {
  return `${row.anchorName} | ${row.shopName} | ${row.startTime}-${row.endTime} | from=${row.effectiveFrom ?? '—'} to=${row.effectiveTo ?? '—'} | ${row.enabled ? 'on' : 'off'} | ${row.note ?? ''}`
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  console.log('[repair-schedule-20260701] dryRun=', dryRun)
  console.log('[repair-schedule-20260701] before templates:')
  const before = await prisma.anchorScheduleTemplate.findMany({
    orderBy: [{ sortOrder: 'asc' }, { anchorName: 'asc' }],
  })
  for (const row of before) {
    console.log('  ', formatTemplateRow(row))
  }

  const templates0701Before = DEFAULT_SCHEDULE_TEMPLATE_SEEDS.filter((seed) =>
    templateAppliesOnDate(seed, NEW_SCHEDULE_START_DATE),
  )
  console.log(
    `[repair-schedule-20260701] seeds applying on ${NEW_SCHEDULE_START_DATE} (code): ${templates0701Before.length}`,
  )
  for (const seed of templates0701Before) {
    console.log('  ', `${seed.anchorName} ${seed.startTime}-${seed.endTime} ${seed.shopName}`)
  }

  const result = await repairScheduleTemplatesFrom20260701({ dryRun })

  console.log('[repair-schedule-20260701] result:', JSON.stringify(result, null, 2))

  if (!dryRun) {
    console.log('[repair-schedule-20260701] after templates:')
    const after = await prisma.anchorScheduleTemplate.findMany({
      orderBy: [{ sortOrder: 'asc' }, { anchorName: 'asc' }],
    })
    for (const row of after) {
      console.log('  ', formatTemplateRow(row))
    }

    const active0701 = after.filter((row) =>
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

    if (active0701.length !== NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.length) {
      throw new Error(
        `[repair-schedule-20260701] expected ${NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.length} active templates on ${NEW_SCHEDULE_START_DATE}, got ${active0701.length}`,
      )
    }

    const manualOld = await prisma.anchorDailySchedule.count({
      where: { scheduleDate: { gte: NEW_SCHEDULE_START_DATE }, source: 'manual' },
    })
    if (manualOld > 0) {
      console.log(
        `[repair-schedule-20260701] WARN: ${manualOld} manual schedule rows kept on/after ${NEW_SCHEDULE_START_DATE}; review if still using old times`,
      )
    }
  }

  console.log('[repair-schedule-20260701] OK')
}

main()
  .catch((err) => {
    console.error('[repair-schedule-20260701] FAIL', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
