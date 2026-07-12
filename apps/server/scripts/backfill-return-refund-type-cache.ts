/**
 * 从已有 rawDetail 回填售后结构化分类字段；
 * 对有退款信号但无缓存的订单入队售后补数。
 *
 * 用法：
 *   npx tsx apps/server/scripts/backfill-return-refund-type-cache.ts
 *   npx tsx apps/server/scripts/backfill-return-refund-type-cache.ts --enqueue-missing
 */
import { prisma } from '../src/lib/prisma'
import { deriveStructuredAfterSaleTypeFromRaw } from '../src/services/resolve-return-refund-classification.service'
import { enqueueWorkbenchSync } from '../src/services/xhs-after-sales-workbench.service'

async function backfillFromRawDetail(): Promise<{ scanned: number; updated: number }> {
  const rows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    where: { fetchStatus: { in: ['success', 'empty'] } },
    select: {
      id: true,
      liveAccountId: true,
      orderNo: true,
      rawDetail: true,
      hasReturnRefund: true,
      afterSaleType: true,
    },
  })
  let updated = 0
  for (const row of rows) {
    if (!row.rawDetail || !Array.isArray(row.rawDetail)) continue
    const structured = deriveStructuredAfterSaleTypeFromRaw(row.rawDetail)
    const needsUpdate =
      row.hasReturnRefund !== structured.hasReturnRefund ||
      row.afterSaleType !== structured.afterSaleType ||
      true
    if (!needsUpdate) continue
    await prisma.xhsAfterSalesWorkbenchCache.update({
      where: { id: row.id },
      data: {
        hasReturnRefund: structured.hasReturnRefund,
        hasRefundOnly: structured.hasRefundOnly,
        returnRefundCount: structured.returnRefundCount,
        refundOnlyCount: structured.refundOnlyCount,
        afterSaleType: structured.afterSaleType,
        returnTypeCodes: structured.returnTypeCodes || null,
        classificationSource: structured.classificationSource,
      },
    })
    updated += 1
  }
  return { scanned: rows.length, updated }
}

async function enqueueMissingRefundOrders(): Promise<number> {
  // 订单侧有售后/退款文案，但无成功售后缓存 → 入队补拉
  const orders = await prisma.xhsRawOrder.findMany({
    select: {
      packageId: true,
      orderId: true,
      liveAccountId: true,
      afterSaleStatusText: true,
      orderStatusText: true,
    },
    take: 5000,
  })
  let enqueued = 0
  for (const o of orders) {
    const text = `${o.afterSaleStatusText ?? ''} ${o.orderStatusText ?? ''}`
    if (!/退款|退货|售后/.test(text)) continue
    const orderNo = (o.packageId || o.orderId || '').trim()
    if (!/^P/i.test(orderNo)) continue
    const existing = await prisma.xhsAfterSalesWorkbenchCache.findUnique({
      where: {
        liveAccountId_orderNo: {
          liveAccountId: o.liveAccountId || 'legacy',
          orderNo,
        },
      },
      select: { id: true, hasReturnRefund: true, afterSaleType: true, rawDetail: true },
    })
    if (existing?.rawDetail || existing?.afterSaleType) continue
    await enqueueWorkbenchSync(orderNo, o.liveAccountId || undefined)
    enqueued += 1
  }
  return enqueued
}

async function main() {
  const enqueueMissing = process.argv.includes('--enqueue-missing')
  const backfill = await backfillFromRawDetail()
  console.log(`backfill from rawDetail: scanned=${backfill.scanned} updated=${backfill.updated}`)
  if (enqueueMissing) {
    const n = await enqueueMissingRefundOrders()
    console.log(`enqueued missing workbench sync: ${n}`)
  } else {
    console.log('skip enqueue (pass --enqueue-missing to queue XHS refetch)')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
