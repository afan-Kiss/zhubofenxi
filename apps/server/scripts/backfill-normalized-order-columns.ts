/**
 * Wave4 P2：回填 XhsRawOrder 结构化列
 * npm run backfill:normalized-order-columns -- --dry-run
 * npm run backfill:normalized-order-columns -- --apply --batch-size 200
 */
import { prisma } from '../src/lib/prisma'
import {
  extractNormalizedOrderColumnsFromRaw,
  NORMALIZED_ORDER_COLUMNS_VERSION,
  toPrismaNormalizedOrderColumns,
} from '../src/services/normalized-order-columns.service'

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  if (i < 0) return undefined
  return process.argv[i + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* ignore */
    }
  }
  return {}
}

async function main() {
  const apply = hasFlag('--apply')
  const dryRun = hasFlag('--dry-run') || !apply
  const limit = Number(argValue('--limit') || '0') || 0
  const batchSize = Math.max(1, Number(argValue('--batch-size') || '200') || 200)
  let afterId = argValue('--after-id') || ''

  console.log(
    JSON.stringify({
      mode: dryRun ? 'dry-run' : 'apply',
      limit: limit || 'all',
      batchSize,
      afterId: afterId || null,
      version: NORMALIZED_ORDER_COLUMNS_VERSION,
    }),
  )

  let scanned = 0
  let wouldUpdate = 0
  let updated = 0
  let skippedSame = 0
  let errors = 0

  for (;;) {
    if (limit > 0 && scanned >= limit) break
    const take = limit > 0 ? Math.min(batchSize, limit - scanned) : batchSize
    const rows = await prisma.xhsRawOrder.findMany({
      where: afterId ? { id: { gt: afterId } } : undefined,
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        packageId: true,
        orderId: true,
        liveAccountId: true,
        liveAccountName: true,
        rawJson: true,
        paymentTime: true,
        normalizedVersion: true,
        businessFingerprint: true,
      },
    })
    if (rows.length === 0) break

    for (const row of rows) {
      scanned++
      afterId = row.id
      try {
        const cols = extractNormalizedOrderColumnsFromRaw(asRecord(row.rawJson), {
          dbPackageId: row.packageId,
          dbOrderId: row.orderId,
          liveAccountId: row.liveAccountId,
          liveAccountName: row.liveAccountName,
        })
        const same =
          row.normalizedVersion === cols.normalizedVersion &&
          row.businessFingerprint === cols.businessFingerprint &&
          (row.paymentTime?.getTime() ?? null) === (cols.paymentTime?.getTime() ?? null)
        if (same) {
          skippedSame++
          continue
        }
        wouldUpdate++
        if (!dryRun) {
          await prisma.xhsRawOrder.update({
            where: { id: row.id },
            data: toPrismaNormalizedOrderColumns(cols),
          })
          updated++
        }
      } catch (err) {
        errors++
        console.error('row failed', row.id, err)
      }
    }

    console.log(
      JSON.stringify({
        afterId,
        scanned,
        wouldUpdate,
        updated,
        skippedSame,
        errors,
      }),
    )
  }

  console.log(
    JSON.stringify({
      done: true,
      mode: dryRun ? 'dry-run' : 'apply',
      scanned,
      wouldUpdate,
      updated,
      skippedSame,
      errors,
      nextAfterId: afterId || null,
    }),
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
