/**
 * 一次性：按 login_success 审计纠正 User.lastLoginAt
 * npx tsx apps/server/scripts/repair-last-login-from-audit.ts
 */
import { prisma } from '../src/lib/prisma'
import { reconcileLastLoginAtFromLoginLogs } from '../src/services/user.service'
import { formatDateTimeShanghai } from '../src/utils/business-timezone'

async function main() {
  const before = await prisma.user.findMany({
    select: { username: true, lastLoginAt: true },
    orderBy: { username: 'asc' },
  })
  const result = await reconcileLastLoginAtFromLoginLogs()
  const after = await prisma.user.findMany({
    select: { username: true, lastLoginAt: true, lastLoginIp: true },
    orderBy: { username: 'asc' },
  })
  console.log(
    JSON.stringify(
      {
        result,
        before: before.map((u) => ({
          username: u.username,
          lastLoginAt: u.lastLoginAt ? formatDateTimeShanghai(u.lastLoginAt) : null,
        })),
        after: after.map((u) => ({
          username: u.username,
          lastLoginAt: u.lastLoginAt ? formatDateTimeShanghai(u.lastLoginAt) : null,
          ip: u.lastLoginIp,
        })),
      },
      null,
      2,
    ),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
