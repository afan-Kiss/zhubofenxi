/**
 * 单笔订单售后 API + 本地口径诊断
 * npx tsx apps/server/scripts/diagnose-order-after-sale.ts P796633571104420891 P796633699167420491
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import {
  bootstrapWorkbenchCache,
  fetchAfterSalesWorkbenchByOrderNo,
  loadWorkbenchRefundMapFromDb,
  mergeWorkbenchIntoMemory,
} from '../src/services/xhs-after-sales-workbench.service'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'

config({ path: path.resolve(__dirname, '../.env') })

const orderNos = process.argv.slice(2).filter((a) => /^P/i.test(a))
if (orderNos.length === 0) {
  console.error('用法: npx tsx apps/server/scripts/diagnose-order-after-sale.ts P796633571104420891 ...')
  process.exit(1)
}

async function main(): Promise<void> {
  for (const orderNo of orderNos) {
    console.log(`\n======== ${orderNo} ========`)
    const caches = await prisma.xhsAfterSalesWorkbenchCache.findMany({ where: { orderNo } })
    console.log(`DB cache rows: ${caches.length}`)
    for (const c of caches) {
      console.log(
        JSON.stringify(
          {
            liveAccountId: c.liveAccountId,
            fetchStatus: c.fetchStatus,
            officialRefundAmountCent: c.officialRefundAmountCent,
            successReturnCount: c.successReturnCount,
            afterSaleStatus: c.afterSaleStatus,
            afterSaleReason: c.afterSaleReason,
            fetchedAt: c.fetchedAt,
            fetchError: c.fetchError,
          },
          null,
          2,
        ),
      )
    }

    const rawOrder = await prisma.xhsRawOrder.findFirst({
      where: { OR: [{ packageId: orderNo }, { orderId: orderNo }] },
      select: {
        liveAccountId: true,
        packageId: true,
        buyerId: true,
        rawJson: true,
      },
    })
    const liveAccountId = rawOrder?.liveAccountId ?? 'legacy'
    const rawJson = (rawOrder?.rawJson ?? {}) as Record<string, unknown>
    if (rawOrder) {
      const keys = [
        'afterSaleStatusDesc',
        'after_sale_status_desc',
        'afterSaleStatus',
        'after_sale_status',
        'statusDesc',
        'status_desc',
        'status',
      ]
      const picked: Record<string, unknown> = {}
      for (const k of keys) {
        if (rawJson[k] != null) picked[k] = rawJson[k]
      }
      console.log('Raw status fields:', picked)
    }

    const buyerUserId =
      rawJson.userId != null
        ? String(rawJson.userId)
        : rawJson.buyerId != null
          ? String(rawJson.buyerId)
          : rawOrder?.buyerId ?? undefined
    const api = await fetchAfterSalesWorkbenchByOrderNo(orderNo, liveAccountId, {
      fallbackBuyerUserId: buyerUserId,
    })
    console.log(
      'Live API:',
      JSON.stringify(
        {
          fetchStatus: api.fetchStatus,
          fetchError: api.fetchError,
          officialRefundAmountCent: api.officialRefundAmountCent,
          expectedRefundAmountCent: api.expectedRefundAmountCent,
          appliedAmountCent: api.appliedAmountCent,
          successReturnCount: api.successReturnCount,
          afterSaleReason: api.afterSaleReason,
          afterSaleStatus: api.afterSaleStatus,
          returnsIds: api.returnsIds,
          rawCount: Array.isArray(api.rawDetail) ? api.rawDetail.length : 0,
        },
        null,
        2,
      ),
    )
    if (Array.isArray(api.rawDetail)) {
      for (const r of api.rawDetail) {
        const rec = r as Record<string, unknown>
        console.log(
          '  record:',
          JSON.stringify({
            returns_id: rec.returns_id ?? rec.returnsId,
            refund_fee: rec.refund_fee ?? rec.refundFee,
            status_name: rec.status_name ?? rec.statusName,
            refund_status_name: rec.refund_status_name,
            reason_name_zh: rec.reason_name_zh,
            pay_amount: rec.pay_amount,
          }),
        )
      }
    }
  }

  await bootstrapWorkbenchCache()
  const fromDb = await loadWorkbenchRefundMapFromDb(orderNos)
  for (const [k, v] of fromDb) mergeWorkbenchIntoMemory(k, v)
  const bundle = await buildRawAnalyzeBundleAll()
  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  for (const orderNo of orderNos) {
    const v = artifacts?.views.find((x) => {
      const no = (x.displayOrderNo || x.officialOrderNo || x.packageId || '').trim()
      return no === orderNo
    })
    if (!v) {
      console.log(`\nView not found for ${orderNo}`)
      continue
    }
    console.log(`\n--- Analysis view ${orderNo} ---`)
    console.log(
      JSON.stringify(
        {
          orderStatusText: v.orderStatusText,
          afterSaleStatusText: v.afterSaleStatusText,
          isEffectiveSigned: v.isEffectiveSigned,
          isActualSigned: v.isActualSigned,
          productRefundAmountCent: v.productRefundAmountCent,
          buyerProductRefundAmountCent: v.buyerProductRefundAmountCent,
          buyerProductRefundSource: v.buyerProductRefundSource,
          actualSignAmountCent: v.actualSignAmountCent,
          includedInGmv: v.includedInGmv,
          effectiveGmvCent: v.effectiveGmvCent,
          isEffectiveSignedView: isEffectiveSignedView(v),
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
