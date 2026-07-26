/**
 * 强制重同步四店官方总分（写入 BossShopScoreSnapshot.officialOverallScore）
 * 并对「最近快照中 officialOverallScore 为空」的行做安全回填（用当前接口官方总分，不臆造历史分项）
 *
 * 用法：npx tsx apps/server/scripts/resync-boss-shop-score-official.ts
 */
import { GOOD_REVIEW_SHOPS } from '../src/config/good-review-shops.constants'
import { syncBossShopScoreForShop } from '../src/services/boss-dashboard/boss-dashboard-score.service'
import { resolveOfficialShopAccountForStatus } from '../src/services/official-shop-account.service'
import { parseBossShopScore } from '../src/services/boss-dashboard/boss-dashboard-normalize.service'
import { fetchBossShopScore } from '../src/services/boss-dashboard/boss-dashboard-api.service'
import { prisma } from '../src/lib/prisma'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import { normalizeOfficialDisplayScore } from '../src/services/boss-dashboard/boss-shop-score-official.util'

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + deltaDays))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

async function main() {
  const today = formatDateKeyShanghai()
  const since = shiftDateKey(today, -7)

  for (const shop of GOOD_REVIEW_SHOPS) {
    const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
    if (!account?.id) {
      console.log(`[skip] ${shop.shopName} 无账号`)
      continue
    }
    console.log(`\n=== ${shop.shopKey} ${shop.shopName} ===`)
    const live = await fetchBossShopScore(shop)
    const parsed = parseBossShopScore(live)
    const official = normalizeOfficialDisplayScore(parsed.officialOverallScore)
    console.log('接口官方总分', official)

    const result = await syncBossShopScoreForShop({
      shop,
      liveAccountId: account.id,
      forceFetch: true,
    })
    console.log('同步结果', result)

    if (official != null) {
      const patched = await prisma.bossShopScoreSnapshot.updateMany({
        where: {
          shopKey: shop.shopKey,
          scoreDate: { gte: since },
          officialOverallScore: null,
        },
        data: {
          officialOverallScore: official,
          ...(parsed.raw ? { rawJson: JSON.stringify(parsed.raw) } : {}),
        },
      })
      console.log(`回填最近空总分 ${patched.count} 行 (>=${since})`)
    }

    const row = await prisma.bossShopScoreSnapshot.findFirst({
      where: { shopKey: shop.shopKey },
      orderBy: { scoreDate: 'desc' },
    })
    console.log('DB 最新', {
      scoreDate: row?.scoreDate,
      officialOverallScore: row?.officialOverallScore,
      q: row?.qualityScore,
      l: row?.logisticsScore,
      s: row?.serviceScore,
    })
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
