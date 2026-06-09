import { prisma } from '../../src/lib/prisma'
import { getOrBuildBusinessBoardCache } from '../../src/services/business-cache.service'
import { calculateBusinessMetrics } from '../../src/services/business-metrics.service'

const ids = ['P795833718995032251', 'P795842411393032571']

async function main() {
  const rows = await prisma.xhsRawOrder.findMany({
    where: {
      OR: ids.map((id) => ({ OR: [{ packageId: id }, { orderId: id }] })),
    },
    select: { packageId: true, orderId: true, orderTime: true, liveAccountName: true },
  })
  console.log('DB rows:', rows)

  const cache = await getOrBuildBusinessBoardCache({ preset: 'today' })
  const m = calculateBusinessMetrics(cache.views)
  console.log('today:', {
    orderCount: m.orderCount,
    totalGmvYuan: m.totalGmv,
    viewCount: cache.views.length,
  })

  for (const id of ids) {
    const hit = cache.views.find(
      (v) =>
        v.officialOrderNo === id ||
        v.packageId === id ||
        String(v.officialOrderNo ?? '').includes(id),
    )
    console.log(id, hit ? { anchor: hit.anchorName, cent: hit.officialPaidAmountCent } : 'NOT IN VIEWS')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
