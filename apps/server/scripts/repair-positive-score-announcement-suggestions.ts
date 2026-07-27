/**
 * 重写历史 score_change 公告（幂等）：
 * - 优先用 currentScore - previousScore 重算 delta
 * - 再统一 tone / title / content / suggestion
 * - 负向按 metricKey 补正确建议；正向 suggestion=null
 * - 事务；支持 --dry-run
 * - 不得根据标题文字反向篡改分数
 *
 * 用法：
 *   npx tsx apps/server/scripts/repair-positive-score-announcement-suggestions.ts
 *   npx tsx apps/server/scripts/repair-positive-score-announcement-suggestions.ts --dry-run
 */
import { prisma } from '../src/lib/prisma'

const METRIC_LABELS: Record<string, string> = {
  qualityScore: '品质分',
  logisticsScore: '物流分',
  serviceScore: '服务分',
  officialOverallScore: '综合体验分',
}

const SCORE_ADVICE: Record<string, string> = {
  qualityScore:
    '品质分下降，优先检查直播中颜色、材质、证书、天然包容和尺寸是否说清楚，并查看最近新增的品质负向反馈。',
  logisticsScore:
    '物流分下降，检查付款后超过24小时仍未揽收的订单，以及异常中转、错发和漏发情况。',
  serviceScore:
    '服务分下降，检查客服三分钟回复率、售后响应速度、满意度和平台介入订单。',
}

function roundDelta(n: number): number {
  return Math.round(n * 100) / 100
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const rows = await prisma.bossAnnouncement.findMany({
    where: { kind: 'score_change' },
    orderBy: { createdAt: 'asc' },
  })

  let scanned = 0
  let wouldUpdate = 0
  let updated = 0
  let skippedNoScores = 0
  let unchanged = 0

  type Patch = {
    id: string
    title: string
    content: string
    tone: string
    deltaScore: number
    suggestion: string | null
  }
  const patches: Patch[] = []

  for (const row of rows) {
    scanned += 1
    const previous = row.previousScore
    const current = row.currentScore
    if (typeof previous !== 'number' || typeof current !== 'number') {
      skippedNoScores += 1
      continue
    }
    const delta = roundDelta(current - previous)
    if (delta === 0) {
      unchanged += 1
      continue
    }
    const metricKey = row.metricKey ?? ''
    const label = (METRIC_LABELS[metricKey] ?? metricKey) || '店铺分'
    const tone = delta > 0 ? 'positive' : 'negative'
    const shopName = row.shopName ?? ''
    const title = `${shopName}${label}${delta > 0 ? '上升' : '下降'}`
    const content = `${label}由 ${previous} 变为 ${current}（${delta > 0 ? '+' : ''}${delta}）`
    const suggestion = delta < 0 ? (SCORE_ADVICE[metricKey] ?? null) : null

    const same =
      row.tone === tone &&
      row.title === title &&
      row.content === content &&
      row.deltaScore === delta &&
      (row.suggestion ?? null) === suggestion
    if (same) {
      unchanged += 1
      continue
    }
    wouldUpdate += 1
    patches.push({
      id: row.id,
      title,
      content,
      tone,
      deltaScore: delta,
      suggestion,
    })
  }

  if (!dryRun && patches.length > 0) {
    await prisma.$transaction(
      patches.map((p) =>
        prisma.bossAnnouncement.update({
          where: { id: p.id },
          data: {
            title: p.title,
            content: p.content,
            tone: p.tone,
            deltaScore: p.deltaScore,
            suggestion: p.suggestion,
          },
        }),
      ),
    )
    updated = patches.length
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        scanned,
        wouldUpdate,
        updated: dryRun ? 0 : updated,
        skippedNoScores,
        unchanged,
        sample: patches.slice(0, 5).map((p) => ({
          id: p.id,
          title: p.title,
          tone: p.tone,
          deltaScore: p.deltaScore,
          suggestion: p.suggestion?.slice(0, 24) ?? null,
        })),
      },
      null,
      2,
    ),
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
