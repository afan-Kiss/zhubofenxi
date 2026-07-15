/**
 * Wave4 P2：结构化读模型与旧 orderTime 预筛结果等价
 * npm run verify:normalized-order-read-model
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  buildOrderRangeDbWhere,
  buildOrderTimeDbWhere,
  loadNormalizedOrdersFromRaw,
  normalizeXhsOrderPackage,
} from '../src/services/xhs-api-sync/xhs-json-normalizer.service'
import {
  extractNormalizedOrderColumnsFromRaw,
  NORMALIZED_ORDER_COLUMNS_VERSION,
} from '../src/services/normalized-order-columns.service'
import { orderPayTimeInRange } from '../src/utils/order-stat-time.util'
import { resolveDateRange } from '../src/utils/date-range'

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

async function main() {
  const range = resolveDateRange('custom', '2026-07-01', '2026-07-14')

  const sample = await prisma.xhsRawOrder.findMany({ take: 20, orderBy: { updatedAt: 'desc' } })
  for (const row of sample) {
    const cols = extractNormalizedOrderColumnsFromRaw(asRecord(row.rawJson), {
      dbPackageId: row.packageId,
      dbOrderId: row.orderId,
      liveAccountId: row.liveAccountId,
      liveAccountName: row.liveAccountName,
    })
    assert.equal(cols.normalizedVersion, NORMALIZED_ORDER_COLUMNS_VERSION)
    const normalized = normalizeXhsOrderPackage(asRecord(row.rawJson), 1, {
      dbPackageId: row.packageId,
      dbOrderId: row.orderId,
      liveAccountId: row.liveAccountId,
      liveAccountName: row.liveAccountName,
    })
    assert.equal(cols.gmvCent, normalized.gmvCent)
    assert.equal(cols.paymentTime?.getTime() ?? null, normalized.paymentTime?.getTime() ?? null)
  }
  console.log('ok sample column extract <=> normalize', sample.length)

  const legacyRows = await prisma.xhsRawOrder.findMany({
    where: buildOrderTimeDbWhere(range),
    select: { id: true, rawJson: true, packageId: true, orderId: true, liveAccountId: true, liveAccountName: true },
  })
  const hybridRows = await prisma.xhsRawOrder.findMany({
    where: buildOrderRangeDbWhere(range),
    select: { id: true },
  })
  console.log('db prefilter sizes', { legacy: legacyRows.length, hybrid: hybridRows.length })

  // 回填后 hybrid 会按 paymentTime 收窄，不必再是 legacy 超集；只要求支付口径结果一致。
  const legacyPayMatched = legacyRows
    .map((row) =>
      normalizeXhsOrderPackage(asRecord(row.rawJson), 1, {
        dbPackageId: row.packageId,
        dbOrderId: row.orderId,
        liveAccountId: row.liveAccountId,
        liveAccountName: row.liveAccountName,
      }),
    )
    .filter((o) => orderPayTimeInRange(o, range))

  const loaded = await loadNormalizedOrdersFromRaw({ range })
  const legacyKey = (o: {
    packageId?: string
    orderId?: string
    liveAccountId?: string
    paymentTime?: Date | null
    gmvCent?: number
  }) =>
    `${o.liveAccountId || ''}|${o.packageId || o.orderId || ''}|${o.paymentTime?.getTime() ?? ''}|${o.gmvCent ?? 0}`

  const a = new Map(legacyPayMatched.map((o) => [legacyKey(o), o.gmvCent]))
  const b = new Map(loaded.map((o) => [legacyKey(o), o.gmvCent]))
  assert.equal(a.size, b.size, `count mismatch legacy=${a.size} loaded=${b.size}`)
  let gmvA = 0
  let gmvB = 0
  for (const [k, v] of a) {
    assert.ok(b.has(k), `missing ${k}`)
    assert.equal(b.get(k), v)
    gmvA += v
  }
  for (const v of b.values()) gmvB += v
  assert.equal(gmvA, gmvB)
  console.log('ok loadNormalizedOrdersFromRaw ≡ legacy pay-filter', {
    orders: a.size,
    gmvCent: gmvA,
    range: `${range.startDate}~${range.endDate}`,
    hybridNarrowed: hybridRows.length < legacyRows.length,
  })

  console.log('verify:normalized-order-read-model PASS')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
