/**
 * 删除四店模式下 legacy 默认占位 Cookie（platformName=xiaohongshu）
 * 用法: npx tsx apps/server/scripts/purge-legacy-default-credential.ts
 */
import { deleteLegacyDefaultPlatformCredentialIfUnused } from '../src/services/official-shop-account.service'
import { prisma } from '../src/lib/prisma'

async function main(): Promise<void> {
  const result = await deleteLegacyDefaultPlatformCredentialIfUnused()
  console.log('[purge-legacy-default-credential]', JSON.stringify(result))
  if (!result.deleted && result.reason && result.reason !== 'not_found') {
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('[purge-legacy-default-credential] FAILED', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
