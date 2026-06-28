import { prisma } from '../lib/prisma'
import { hashPassword } from '../utils/password'

const DEFAULT_ADMIN_USERNAME = 'admin'
const DEFAULT_ADMIN_PASSWORD = 'admin123456'
const PRIMARY_SUPER_ADMIN_USERNAME = 'fanfan'

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
      managedPassword: DEFAULT_ADMIN_PASSWORD,
      role: 'super_admin',
      enabled: true,
      mustChangePassword: true,
    },
  })

  console.log('[bootstrap] 已创建默认超级管理员账号，请登录后尽快修改密码')
}

/** 确保 fanfan 账号为超级管理员（若已注册） */
export async function ensurePrimarySuperAdmin(): Promise<void> {
  const row = await prisma.user.findUnique({
    where: { username: PRIMARY_SUPER_ADMIN_USERNAME },
  })
  if (!row) return
  if (row.role === 'super_admin' && row.enabled) return

  await prisma.user.update({
    where: { id: row.id },
    data: { role: 'super_admin', enabled: true },
  })
  console.log(`[bootstrap] 已将 ${PRIMARY_SUPER_ADMIN_USERNAME} 设为超级管理员`)
}

export function isDefaultAdminCredentials(username: string): boolean {
  return username === DEFAULT_ADMIN_USERNAME
}
