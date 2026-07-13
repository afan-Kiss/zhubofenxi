/**
 * 强制重查福袋发货记录的顺丰月结费用（生产排查用）
 * 用法: npx tsx apps/server/scripts/refresh-lucky-gift-sf-fees.ts [waybill]
 */
import { prisma } from '../src/lib/prisma'
import { isSfTrackingNo, queryAndCacheSfFeeForShipment } from '../src/services/lucky-gift/lucky-gift-sf-fee.service'

async function main() {
  const waybillFilter = process.argv[2]?.trim().toUpperCase()
  const rows = await prisma.luckyGiftShipment.findMany({
    where: waybillFilter
      ? {
          OR: [
            { trackingNo: { contains: waybillFilter } },
            { winner: { officialTrackingNo: { contains: waybillFilter } } },
          ],
        }
      : {
          sfFeeStatus: { in: ['failed', 'unknown'] },
          OR: [
            { trackingNo: { startsWith: 'SF' } },
            { trackingNo: { startsWith: 'sf' } },
            { winner: { officialTrackingNo: { startsWith: 'SF' } } },
            { winner: { officialTrackingNo: { startsWith: 'sf' } } },
          ],
        },
    take: waybillFilter ? 5 : 15,
    include: { winner: { select: { officialTrackingNo: true, liveAccountName: true } } },
  })

  const out: Array<Record<string, unknown>> = []
  for (const s of rows) {
    const tracking = String(s.trackingNo || s.winner?.officialTrackingNo || '')
      .trim()
      .toUpperCase()
    if (!isSfTrackingNo(tracking)) continue
    const r = await queryAndCacheSfFeeForShipment(s.id, tracking, true)
    out.push({
      shop: s.winner?.liveAccountName ?? null,
      tracking,
      status: r.sfFeeStatus,
      fee: r.sfMonthlyFeeYuan,
      err: r.sfFeeError,
    })
  }
  console.log(JSON.stringify(out, null, 2))
}

void main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
