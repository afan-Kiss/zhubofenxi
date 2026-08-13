/**
 * 将已存官方品退按订单主表重新匹配（含跨店唯一 P 单号纠正）。
 * 用法：npx tsx apps/server/scripts/rematch-quality-bad-cases-once.ts
 */
import { rematchStoredQualityBadCases } from '../src/services/official-quality-refund-sync.service'
import { prisma } from '../src/lib/prisma'

async function main() {
  const before = await prisma.qualityBadCase.groupBy({
    by: ['matchStatus'],
    _count: { _all: true },
  })
  const n = await rematchStoredQualityBadCases()
  const after = await prisma.qualityBadCase.groupBy({
    by: ['matchStatus'],
    _count: { _all: true },
  })
  const sample = await prisma.qualityBadCase.findMany({
    where: {
      packageId: { in: ['P799735431558477031', 'P800331172827463091'] },
    },
    select: {
      liveAccountId: true,
      packageId: true,
      matchStatus: true,
      matchedOrderNo: true,
      sourceBizId: true,
    },
  })
  console.log(
    JSON.stringify(
      {
        rematchedRows: n,
        before,
        after,
        twoJulyOrders: sample,
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
