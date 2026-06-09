import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
const ids = [
  'P795873841192480241',
  'P795864850278181221',
  'P795863214845122861',
]

for (const id of ids) {
  const order = await p.xhsRawOrder.findFirst({
    where: { OR: [{ packageId: id }, { orderId: id }] },
    select: { packageId: true, liveAccountId: true, orderStatus: true, afterSaleStatus: true },
  })
  const wb = await p.afterSalesWorkbenchCache.findMany({
    where: { packageId: id },
    take: 3,
  })
  const raw = await p.xhsRawAfterSale.findMany({
    where: { OR: [{ packageId: id }, { orderNo: id }] },
    take: 5,
  })
  console.log('\n===', id, '===')
  console.log('order', order)
  console.log('workbench cache', wb.length, wb[0] ? { status: wb[0].fetchStatus, cent: wb[0].officialRefundAmountCent } : null)
  console.log('raw after sale', raw.length)
  for (const r of raw.slice(0, 2)) {
    const j = typeof r.rawJson === 'string' ? JSON.parse(r.rawJson) : r.rawJson
    console.log('  status', j?.status_name ?? j?.refund_status_name, 'fee', j?.refund_fee ?? j?.refundFee)
  }
}

await p.$disconnect()
