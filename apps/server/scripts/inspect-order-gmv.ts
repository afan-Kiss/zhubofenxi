import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { resolveDateRange } from '../src/utils/date-range'
import { normalizeXhsOrderPackage } from '../src/services/xhs-api-sync/xhs-json-normalizer.service'
import { buildRawAnalyzeBundle } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { attributeOrders } from '../src/services/order-attribution.service'
import { refreshAnchorConfigCache } from '../src/services/anchor.service'
import { centToYuan } from '../src/utils/money'

config({ path: path.resolve(__dirname, '../.env') })
const prisma = new PrismaClient()
const PKG = 'P795491110326121261'

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

async function main(): Promise<void> {
  await refreshAnchorConfigCache()
  const row = await prisma.xhsRawOrder.findFirst({ where: { packageId: PKG } })
  if (!row) {
    console.log('DB 无此 packageId')
    return
  }
  console.log('=== DB xhsRawOrder ===')
  console.log(JSON.stringify({
    id: row.id,
    packageId: row.packageId,
    orderId: row.orderId,
    orderTime: row.orderTime?.toISOString(),
    buyerId: row.buyerId,
    syncJobId: row.syncJobId,
    createdAt: row.createdAt.toISOString(),
  }, null, 2))

  const raw = asRecord(row.rawJson)
  console.log('\n=== rawJson 关键字段 ===')
  const keys = [
    'packageId', 'orderId', 'status', 'statusDesc', 'afterSaleStatus', 'afterSaleStatusDesc',
    'orderedAt', 'paidAt', 'finishTime', 'completedAt', 'cancelTime', 'cancelledAt',
    'liveId', 'roomId', 'anchorName', 'userInfo', 'skus',
  ]
  const pick: Record<string, unknown> = {}
  for (const k of keys) {
    if (raw[k] != null) pick[k] = raw[k]
  }
  console.log(JSON.stringify(pick, null, 2))

  const norm = normalizeXhsOrderPackage(raw, 1)
  console.log('\n=== normalizeXhsOrderPackage ===')
  console.log(JSON.stringify({
    packageId: norm.packageId,
    bizOrderId: norm.bizOrderId,
    matchOrderId: norm.matchOrderId,
    gmvCent: norm.gmvCent,
    gmvYuan: centToYuan(norm.gmvCent),
    receivableAmountCent: norm.receivableAmountCent,
    actualSellerReceiveAmountCent: norm.actualSellerReceiveAmountCent,
    gmvSourceUsed: norm.gmvSourceUsed,
    orderStatusText: norm.orderStatusText,
    afterSaleStatusText: norm.afterSaleStatusText,
    isSigned: norm.isSigned,
    isReturned: norm.isReturned,
    isQualityReturn: norm.isQualityReturn,
    orderTime: norm.orderTime?.toISOString(),
    orderTimeText: norm.orderTimeText,
    reasonText: norm.reasonText,
    errors: norm.errors,
    amountWarnings: norm.amountWarnings,
  }, null, 2))

  const range = resolveDateRange('custom', '2026-05-28', '2026-05-28')
  const inRangeByPipeline =
    norm.orderTime != null &&
    norm.orderTime.getTime() >= range.startTimeMs &&
    norm.orderTime.getTime() <= range.endTimeMs

  const bundle = await buildRawAnalyzeBundle(range)
  const inBundle = bundle?.orders.some((o) => o.matchOrderId === PKG)
  const art = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const inDeduped = art?.dedupe.uniqueOrders.some((o) => o.matchOrderId === PKG)
  const inViews = art?.views.some((v) => (v.matchOrderId || v.orderId) === PKG)
  const dupGroup = art?.dedupe.duplicateOrders.find((g) => g.matchOrderId === PKG)

  console.log('\n=== 范围与去重 ===')
  console.log({
    range: `${range.startDate}~${range.endDate}`,
    startTimeMs: range.startTimeMs,
    endTimeMs: range.endTimeMs,
    orderTimeMs: norm.orderTime?.getTime(),
    inRangeByPipeline,
    inBundle,
    inDeduped,
    inViews,
    duplicateGroupSize: dupGroup?.orders.length ?? 0,
  })

  if (bundle && art) {
    const anchorConfig = await refreshAnchorConfigCache()
    const attr = attributeOrders(art.dedupe.uniqueOrders, bundle.liveSessions, anchorConfig)
    const a = attr.get(PKG)
    console.log('\n=== 直播归属 ===')
    console.log(a ?? '未归属')
    console.log('liveSessions in range:', bundle.liveSessions.length)
  }
}

main()
  .catch(console.error)
  .finally(() => void prisma.$disconnect())
