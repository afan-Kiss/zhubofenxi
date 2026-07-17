/**
 * 只读：已停用但缺少离职日期的主播
 * npx tsx apps/server/scripts/diagnose-anchor-offboard-dates.ts
 */
import { prisma } from '../src/lib/prisma'
import { isOffboardDateMissing } from '../src/utils/anchor-effective-date.util'

async function main() {
  const rows = await prisma.anchor.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })

  console.log('diagnose-anchor-offboard-dates（只读）\n')

  let needPatch = 0
  for (const a of rows) {
    if (!isOffboardDateMissing(a) && a.enabled) continue
    const lastSchedule = await prisma.anchorDailySchedule.findFirst({
      where: {
        OR: [{ anchorId: a.id }, { anchorName: a.name }],
        isTemporaryAnchor: false,
      },
      orderBy: { scheduleDate: 'desc' },
      select: { scheduleDate: true },
    })

    const needs = isOffboardDateMissing(a)
    if (needs) needPatch++

    console.log(
      JSON.stringify(
        {
          id: a.id,
          name: a.name,
          enabled: a.enabled,
          effectiveFrom: a.effectiveFrom,
          effectiveTo: a.effectiveTo,
          lastScheduleDate: lastSchedule?.scheduleDate ?? null,
          needsManualOffboardDate: needs,
        },
        null,
        2,
      ),
    )
  }

  console.log(`\n需要人工补录离职日期：${needPatch}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
