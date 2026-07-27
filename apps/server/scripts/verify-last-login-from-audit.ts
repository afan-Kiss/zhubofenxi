/**
 * 用 login_success 审计回填 User.lastLoginAt，并校验「最近登录 ≠ /me 活跃」
 * npx tsx apps/server/scripts/verify-last-login-from-audit.ts
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  reconcileLastLoginAtFromLoginLogs,
  recordUserLogin,
} from '../src/services/user.service'
import { buildAuthMePayload } from '../src/services/auth.service'
import type { UserRole } from '../src/types/roles'

async function main() {
  console.log('verify-last-login-from-audit')

  const user = await prisma.user.findFirst({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!user) {
    console.log('SKIP: no users')
    return
  }

  const before = user.lastLoginAt
  await buildAuthMePayload({
    id: user.id,
    username: user.username,
    role: user.role as UserRole,
  })
  const afterMe = await prisma.user.findUnique({
    where: { id: user.id },
    select: { lastLoginAt: true },
  })
  assert.equal(
    afterMe?.lastLoginAt?.getTime() ?? null,
    before?.getTime() ?? null,
    '/me 不应改写 lastLoginAt',
  )

  const t0 = Date.now()
  await recordUserLogin(user.id, { ip: '127.0.0.1', userAgent: 'verify-agent' })
  const afterLogin = await prisma.user.findUnique({
    where: { id: user.id },
    select: { lastLoginAt: true, lastLoginIp: true },
  })
  assert.ok(afterLogin?.lastLoginAt && afterLogin.lastLoginAt.getTime() >= t0)
  assert.equal(afterLogin?.lastLoginIp, '127.0.0.1')

  // 恢复为审计中的真实登录时间，避免本地验收污染 lastLoginAt
  const result = await reconcileLastLoginAtFromLoginLogs()
  assert.ok(result.updated + result.skipped >= 1)

  console.log('PASS verify-last-login-from-audit', result)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
