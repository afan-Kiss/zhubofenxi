/**
 * 重置用户为 super_admin 并设置密码。
 * 用法：tsx apps/server/scripts/reset-user-admin.ts <username> <password>
 */
import { prisma } from '../src/lib/prisma'
import { hashPassword } from '../src/utils/password'

async function main() {
  const username = process.argv[2]?.trim()
  const password = process.argv[3]
  if (!username || !password) {
    console.error('用法: tsx apps/server/scripts/reset-user-admin.ts <username> <password>')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('[reset-user-admin] 密码长度不能少于 8 位')
    process.exit(1)
  }

  const row = await prisma.user.findUnique({ where: { username } })
  const passwordHash = await hashPassword(password)

  if (!row) {
    await prisma.user.create({
      data: {
        username,
        passwordHash,
        managedPassword: password,
        role: 'super_admin',
        enabled: true,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    })
    console.log(`[reset-user-admin] 已创建 ${username} 超级管理员账号`)
    return
  }

  await prisma.user.update({
    where: { id: row.id },
    data: {
      role: 'super_admin',
      enabled: true,
      passwordHash,
      managedPassword: password,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  })
  await prisma.session.deleteMany({ where: { userId: row.id } })

  console.log(`[reset-user-admin] ${username} 已设为超级管理员，密码已重置`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
