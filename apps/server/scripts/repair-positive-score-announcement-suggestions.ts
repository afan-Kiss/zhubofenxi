/**
 * 幂等修复：正向店铺分公告不得带「下降」建议；纠正 tone/title/delta 不一致。
 * 用法：npx tsx apps/server/scripts/repair-positive-score-announcement-suggestions.ts
 */
import { prisma } from '../src/lib/prisma'

async function main() {
  const scanned = await prisma.bossAnnouncement.count({
    where: { kind: 'score_change' },
  })

  const positiveWithTip = await prisma.bossAnnouncement.findMany({
    where: { kind: 'score_change', tone: 'positive', suggestion: { not: null } },
    select: { id: true },
  })
  const clearTips = await prisma.bossAnnouncement.updateMany({
    where: { kind: 'score_change', tone: 'positive', suggestion: { not: null } },
    data: { suggestion: null },
  })

  const riseButNeg = await prisma.bossAnnouncement.findMany({
    where: { kind: 'score_change', title: { contains: '上升' }, tone: 'negative' },
  })
  let riseFixed = 0
  for (const row of riseButNeg) {
    await prisma.bossAnnouncement.update({
      where: { id: row.id },
      data: {
        tone: 'positive',
        suggestion: null,
        deltaScore:
          row.deltaScore != null && row.deltaScore < 0 ? Math.abs(row.deltaScore) : row.deltaScore,
      },
    })
    riseFixed += 1
  }

  const downButPos = await prisma.bossAnnouncement.findMany({
    where: { kind: 'score_change', title: { contains: '下降' }, tone: 'positive' },
  })
  let downFixed = 0
  for (const row of downButPos) {
    await prisma.bossAnnouncement.update({
      where: { id: row.id },
      data: {
        tone: 'negative',
        deltaScore:
          row.deltaScore != null && row.deltaScore > 0 ? -Math.abs(row.deltaScore) : row.deltaScore,
      },
    })
    downFixed += 1
  }

  const posDeltaNegTone = await prisma.bossAnnouncement.updateMany({
    where: { kind: 'score_change', deltaScore: { gt: 0 }, tone: 'negative' },
    data: { tone: 'positive', suggestion: null },
  })
  const negDeltaPosTone = await prisma.bossAnnouncement.updateMany({
    where: { kind: 'score_change', deltaScore: { lt: 0 }, tone: 'positive' },
    data: { tone: 'negative' },
  })

  const remainPositiveTip = await prisma.bossAnnouncement.count({
    where: { kind: 'score_change', tone: 'positive', suggestion: { not: null } },
  })

  console.log(
    JSON.stringify(
      {
        scanned,
        positiveWithTipBefore: positiveWithTip.length,
        clearedSuggestions: clearTips.count,
        riseTitleToneFixed: riseFixed,
        downTitleToneFixed: downFixed,
        posDeltaToneFixed: posDeltaNegTone.count,
        negDeltaToneFixed: negDeltaPosTone.count,
        remainPositiveTip,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
