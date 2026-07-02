/**
 * 删除四店历史重复账号（仅 PlatformCredential 配置行）
 * 用法: npx tsx apps/server/scripts/purge-legacy-shop-accounts.ts
 */
import { prisma } from '../src/lib/prisma'
import { isLegacyDuplicateShopAccountRow } from '../src/services/official-shop-account.service'
import { deleteLegacyDuplicateLiveAccounts } from '../src/services/live-account.service'

async function main(): Promise<void> {
  const before = await prisma.platformCredential.findMany({ orderBy: { createdAt: 'asc' } })
  const legacy = before.filter((row) => isLegacyDuplicateShopAccountRow(row))
  console.log(`[purge-legacy] before: ${legacy.length} legacy duplicate account(s)`)
  for (const row of legacy) {
    console.log(`  - ${row.displayName?.trim() || row.platformName} (${row.id})`)
  }
  const result = await deleteLegacyDuplicateLiveAccounts()
  console.log(`[purge-legacy] deleted: ${result.deletedCount}`)
  if (result.deletedNames.length > 0) {
    console.log(`[purge-legacy] names: ${result.deletedNames.join(', ')}`)
  }
}

main()
  .catch((err) => {
    console.error('[purge-legacy] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
