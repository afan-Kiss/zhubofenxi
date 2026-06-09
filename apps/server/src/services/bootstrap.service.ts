import { prisma } from '../lib/prisma'
import { hashPassword } from '../utils/password'

const DEFAULT_ADMIN_USERNAME = 'admin'
const DEFAULT_ADMIN_PASSWORD = 'admin123456'

/** 仅在数据库无任何用户时创建默认 admin，并标记需改密 */
export async function ensureDefaultAdmin(): Promise<void> {
  const count = await prisma.user.count()
  if (count > 0) {
    return
  }

  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD)
  await prisma.user.create({
    data: {
      username: DEFAULT_ADMIN_USERNAME,
      passwordHash,
      role: 'super_admin',
      enabled: true,
      mustChangePassword: true,
    },
  })

  console.log('[bootstrap] 已创建默认超级管理员账号，请登录后尽快修改密码')
}

export function isDefaultAdminCredentials(username: string): boolean {
  return username === DEFAULT_ADMIN_USERNAME
}
