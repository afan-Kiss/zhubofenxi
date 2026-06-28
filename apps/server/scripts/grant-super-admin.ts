/**
 * 将指定用户名提升为 super_admin。
 * 用法：tsx apps/server/scripts/grant-super-admin.ts <username>
 */
import { prisma } from '../src/lib/prisma'

async function main() {
  const username = process.argv[2]?.trim()
  if (!username) {
    console.error('用法: tsx apps/server/scripts/grant-super-admin.ts <username>')
    process.exit(1)
  }

  const row = await prisma.user.findUnique({ where: { username } })
  if (!row) {
    console.error(`[grant-super-admin] 用户不存在: ${username}`)
    process.exit(1)
  }

  if (row.role === 'super_admin') {
    console.log(`[grant-super-admin] ${username} 已是超级管理员`)
    return
  }

  await prisma.user.update({
    where: { id: row.id },
    data: { role: 'super_admin', enabled: true },
  })

  console.log(`[grant-super-admin] 已将 ${username} 设为超级管理员`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
