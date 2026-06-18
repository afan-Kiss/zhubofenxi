/**
 * 重新同步指定订单售后工作台缓存
 * npx tsx apps/server/scripts/resync-order-after-sale.ts P796633571104420891 ...
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import {
  pickBuyerUserIdFromRawJson,
  syncWorkbenchForOrderNo,
} from '../src/services/xhs-after-sales-workbench.service'

config({ path: path.resolve(__dirname, '../.env') })

const orderNos = process.argv.slice(2).filter((a) => /^P/i.test(a))
if (orderNos.length === 0) {
  console.error('用法: npx tsx apps/server/scripts/resync-order-after-sale.ts P796633571104420891 ...')
  process.exit(1)
}

async function main(): Promise<void> {
  for (const orderNo of orderNos) {
    const rawOrder = await prisma.xhsRawOrder.findFirst({
      where: { OR: [{ packageId: orderNo }, { orderId: orderNo }] },
      select: { liveAccountId: true, rawJson: true, buyerId: true },
    })
    const liveAccountId = rawOrder?.liveAccountId ?? 'legacy'
    const fallbackBuyerUserId = pickBuyerUserIdFromRawJson(
      rawOrder?.rawJson as Record<string, unknown> | undefined,
      rawOrder?.buyerId,
    )
    const result = await syncWorkbenchForOrderNo(orderNo, liveAccountId, { fallbackBuyerUserId })
    console.log(
      JSON.stringify(
        {
          orderNo,
          liveAccountId,
          fetchStatus: result.fetchStatus,
          officialRefundAmountCent: result.officialRefundAmountCent,
          afterSaleReason: result.afterSaleReason,
          afterSaleStatus: result.afterSaleStatus,
          returnsIds: result.returnsIds,
        },
        null,
        2,
      ),
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
