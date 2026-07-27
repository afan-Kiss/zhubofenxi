/**
 * 最近登录：密码登录 + 保持登录打开系统（/me 节流刷新）
 * npx tsx apps/server/scripts/verify-last-login-from-audit.ts
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  recordUserLogin,
  recordUserLoginIfStale,
  reconcileLastLoginAtFromLoginLogs,
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

  const oldTime = new Date(Date.now() - 60 * 60 * 1000)
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: oldTime },
  })

  await buildAuthMePayload({
    id: user.id,
    username: user.username,
    role: user.role as UserRole,
  }, { ip: '127.0.0.1', userAgent: 'verify-me' })
  const afterMe = await prisma.user.findUnique({
    where: { id: user.id },
    select: { lastLoginAt: true, lastLoginIp: true },
  })
  assert.ok(afterMe?.lastLoginAt && afterMe.lastLoginAt.getTime() > oldTime.getTime(), '/me 应刷新超过 30 分钟的 lastLoginAt')
  assert.equal(afterMe?.lastLoginIp, '127.0.0.1')

  const beforeThrottle = afterMe!.lastLoginAt!
  await recordUserLoginIfStale(user.id, { ip: '127.0.0.2' })
  const throttled = await prisma.user.findUnique({
    where: { id: user.id },
    select: { lastLoginAt: true, lastLoginIp: true },
  })
  assert.equal(throttled?.lastLoginAt?.getTime(), beforeThrottle.getTime(), '30 分钟内不应重复写库')
  assert.equal(throttled?.lastLoginIp, '127.0.0.1')

  const t0 = Date.now()
  await recordUserLogin(user.id, { ip: '127.0.0.3', userAgent: 'verify-login' })
  const afterLogin = await prisma.user.findUnique({
    where: { id: user.id },
    select: { lastLoginAt: true, lastLoginIp: true },
  })
  assert.ok(afterLogin?.lastLoginAt && afterLogin.lastLoginAt.getTime() >= t0)
  assert.equal(afterLogin?.lastLoginIp, '127.0.0.3')

  const result = await reconcileLastLoginAtFromLoginLogs()
  assert.ok(result.skipped >= 1, '已有 lastLoginAt 时不应被审计日志覆盖')

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
