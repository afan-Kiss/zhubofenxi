import { prisma } from '../lib/prisma'

import type { UserRole } from '../types/roles'

import { isUserRole } from '../types/roles'

import { hashPassword, verifyPassword } from '../utils/password'

import { isPrimarySuperAdminUsername } from '../utils/primary-super-admin'

import { writeOperationLog } from './audit.service'



export type SafeUser = {

  id: string

  username: string

  role: UserRole

  enabled: boolean

  mustChangePassword: boolean

  passwordChangedAt: Date | null

  lastLoginAt: Date | null

  createdAt: Date

  updatedAt: Date

}



/** 超级管理员用户列表专用，含可查看的登录密码与客户端信息 */
export type AdminUserView = SafeUser & {
  managedPassword: string | null
  remark: string | null
  registeredIp: string | null
  registeredUserAgent: string | null
  lastLoginIp: string | null
  lastLoginUserAgent: string | null
}



function toSafeUser(user: {

  id: string

  username: string

  role: string

  enabled: boolean

  mustChangePassword: boolean

  passwordChangedAt: Date | null

  lastLoginAt: Date | null

  createdAt: Date

  updatedAt: Date

}): SafeUser {

  if (!isUserRole(user.role)) {

    throw new Error('用户角色数据异常')

  }

  return {

    id: user.id,

    username: user.username,

    role: user.role,

    enabled: user.enabled,

    mustChangePassword: user.mustChangePassword,

    passwordChangedAt: user.passwordChangedAt,

    lastLoginAt: user.lastLoginAt,

    createdAt: user.createdAt,

    updatedAt: user.updatedAt,

  }

}



function toAdminUser(user: {

  id: string

  username: string

  role: string

  enabled: boolean

  mustChangePassword: boolean

  passwordChangedAt: Date | null

  lastLoginAt: Date | null

  createdAt: Date

  updatedAt: Date

  managedPassword: string | null

  remark: string | null

  registeredIp: string | null

  registeredUserAgent: string | null

  lastLoginIp: string | null

  lastLoginUserAgent: string | null

}): AdminUserView {

  return {

    ...toSafeUser(user),

    managedPassword: user.managedPassword,

    remark: user.remark ?? null,

    registeredIp: user.registeredIp,

    registeredUserAgent: user.registeredUserAgent,

    lastLoginIp: user.lastLoginIp,

    lastLoginUserAgent: user.lastLoginUserAgent,

  }

}



export async function findUserByUsername(username: string) {

  return prisma.user.findUnique({ where: { username } })

}



export async function findUserById(id: string) {

  return prisma.user.findUnique({ where: { id } })

}



export async function listUsers(): Promise<AdminUserView[]> {

  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } })

  return users.map(toAdminUser)

}



export async function createUser(input: {

  username: string

  password: string

  role: UserRole

  remark?: string | null

  registration?: { ip?: string | null; userAgent?: string | null }

}): Promise<AdminUserView> {

  const exists = await prisma.user.findUnique({ where: { username: input.username } })

  if (exists) throw new Error('用户名已存在')



  const passwordHash = await hashPassword(input.password)

  const remark = input.remark?.trim() || null

  const user = await prisma.user.create({

    data: {

      username: input.username.trim(),

      passwordHash,

      managedPassword: input.password,

      remark,

      registeredIp: input.registration?.ip?.trim() || null,

      registeredUserAgent: input.registration?.userAgent?.trim() || null,

      role: input.role,

      enabled: true,

      mustChangePassword: false,

      passwordChangedAt: new Date(),

    },

  })

  return toAdminUser(user)

}



/**
 * 账号管理权限：
 * - fanfan 为最高权限，可停用/删除/改角色任意账号（含 admin）
 * - 其他管理员不可动 fanfan，也不可停用/删除/改角色其他超级管理员
 * - 任意管理员可重置自己的密码
 */
export function assertCanManageUser(actor: {
  id: string
  username: string
}, target: {
  id: string
  username: string
  role: string
}, action: 'update' | 'disable' | 'enable' | 'delete' | 'reset_password'): void {
  if (actor.id === target.id && (action === 'disable' || action === 'delete')) {
    throw new Error(action === 'delete' ? '不能删除当前登录账号' : '不能禁用当前登录账号')
  }

  // 自己重置自己的密码始终允许（账号管理页是当前唯一改密入口）
  if (action === 'reset_password' && actor.id === target.id) {
    return
  }

  if (isPrimarySuperAdminUsername(target.username)) {
    if (!isPrimarySuperAdminUsername(actor.username)) {
      throw new Error('无权操作最高权限账号 fanfan')
    }
    if (action === 'disable' || action === 'delete') {
      throw new Error('最高权限账号 fanfan 不可停用或删除')
    }
    return
  }

  const targetIsSuperAdmin = target.role === 'super_admin'
  if (targetIsSuperAdmin && !isPrimarySuperAdminUsername(actor.username)) {
    throw new Error('仅最高权限账号 fanfan 可管理管理员账号')
  }
}

export async function updateUser(
  id: string,
  patch: { role?: UserRole; enabled?: boolean; remark?: string | null },
  actor?: { id: string; username: string },
): Promise<AdminUserView> {
  const target = await findUserById(id)
  if (!target) throw new Error('用户不存在')

  if (actor) {
    assertCanManageUser(actor, target, 'update')
    if (patch.enabled === false) {
      assertCanManageUser(actor, target, 'disable')
    }
    if (patch.enabled === true) {
      assertCanManageUser(actor, target, 'enable')
    }
    if (
      patch.role === 'super_admin' &&
      !isPrimarySuperAdminUsername(actor.username)
    ) {
      throw new Error('仅最高权限账号 fanfan 可设置管理员角色')
    }
  }

  if (isPrimarySuperAdminUsername(target.username)) {
    if (patch.role !== undefined && patch.role !== 'super_admin') {
      throw new Error('最高权限账号 fanfan 必须保持超级管理员角色')
    }
    if (patch.enabled !== undefined && patch.enabled !== target.enabled) {
      throw new Error('最高权限账号 fanfan 的状态不可修改')
    }
  }

  const data: { role?: string; enabled?: boolean; remark?: string | null } = {}
  if (patch.role !== undefined) data.role = patch.role
  if (patch.enabled !== undefined) data.enabled = patch.enabled
  if (patch.remark !== undefined) {
    const next = patch.remark == null ? null : String(patch.remark).trim()
    data.remark = next || null
  }

  const user = await prisma.user.update({ where: { id }, data })
  return toAdminUser(user)
}

export async function disableUser(
  id: string,
  actor: { id: string; username: string; role?: string },
): Promise<SafeUser> {
  const target = await findUserById(id)
  if (!target) throw new Error('用户不存在')
  assertCanManageUser(actor, target, 'disable')

  const updated = await prisma.user.update({
    where: { id },
    data: { enabled: false },
  })
  await writeOperationLog({
    userId: actor.id,
    username: actor.username,
    role: actor.role ?? 'super_admin',
    action: 'disable_user',
    module: 'user',
    description: `停用用户 ${target.username}`,
    meta: { targetUserId: target.id, targetUsername: target.username },
  })
  return toSafeUser(updated)
}

export async function enableUser(
  id: string,
  actor: { id: string; username: string; role?: string },
): Promise<SafeUser> {
  const target = await findUserById(id)
  if (!target) throw new Error('用户不存在')
  assertCanManageUser(actor, target, 'enable')

  const updated = await prisma.user.update({
    where: { id },
    data: { enabled: true },
  })
  await writeOperationLog({
    userId: actor.id,
    username: actor.username,
    role: actor.role ?? 'super_admin',
    action: 'enable_user',
    module: 'user',
    description: `启用用户 ${target.username}`,
    meta: { targetUserId: target.id, targetUsername: target.username },
  })
  return toSafeUser(updated)
}

export async function deleteUser(
  id: string,
  actor: { id: string; username: string; role: string },
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<{ id: string; username: string }> {
  const target = await findUserById(id)
  if (!target) throw new Error('用户不存在')
  assertCanManageUser(actor, target, 'delete')

  await prisma.user.delete({ where: { id } })

  await writeOperationLog({
    userId: actor.id,
    username: actor.username,
    role: actor.role,
    action: 'delete_user',
    module: 'user',
    description: `删除用户 ${target.username}`,
    ip: audit?.ip ?? null,
    userAgent: audit?.userAgent ?? null,
    requestId: audit?.requestId ?? null,
    meta: {
      targetUserId: target.id,
      targetUsername: target.username,
      targetRole: target.role,
    },
  })

  return { id: target.id, username: target.username }
}



/** 写入 User.lastLoginAt（语义：最新访问系统时间） */
export async function recordUserAccess(
  userId: string,
  client?: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      lastLoginAt: new Date(),
      lastLoginIp: client?.ip?.trim() || null,
      lastLoginUserAgent: client?.userAgent?.trim() || null,
    },
  })
}

/** @deprecated 使用 recordUserAccess */
export const recordUserLogin = recordUserAccess

/** 进入系统时节流刷新最新访问；默认 5 分钟，避免每次 /me 写库 */
const LAST_ACCESS_STALE_MS = 5 * 60 * 1000

export async function recordUserAccessIfStale(
  userId: string,
  client?: { ip?: string | null; userAgent?: string | null },
  staleMs: number = LAST_ACCESS_STALE_MS,
): Promise<void> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastLoginAt: true },
  })
  if (!row) return
  if (row.lastLoginAt && Date.now() - row.lastLoginAt.getTime() < staleMs) return
  await recordUserAccess(userId, client)
}

/** @deprecated 使用 recordUserAccessIfStale */
export const recordUserLoginIfStale = recordUserAccessIfStale

/**
 * 仅当 lastLoginAt 为空时，用 login_success 审计回填（不覆盖已有的较新访问时间）。
 */
export async function reconcileLastLoginAtFromLoginLogs(): Promise<{
  updated: number
  skipped: number
}> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      lastLoginAt: true,
      lastLoginIp: true,
      lastLoginUserAgent: true,
    },
  })
  let updated = 0
  let skipped = 0
  for (const user of users) {
    if (user.lastLoginAt) {
      skipped += 1
      continue
    }
    const log = await prisma.operationLog.findFirst({
      where: { username: user.username, action: 'login_success' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, ip: true, userAgent: true },
    })
    if (!log) {
      skipped += 1
      continue
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: log.createdAt,
        lastLoginIp: log.ip?.trim() || user.lastLoginIp,
        lastLoginUserAgent: log.userAgent?.trim() || user.lastLoginUserAgent,
      },
    })
    updated += 1
  }
  return { updated, skipped }
}

export async function touchLastLogin(userId: string): Promise<void> {
  await recordUserAccess(userId)
}



export async function changeOwnPassword(input: {

  userId: string

  username: string

  role: string

  oldPassword: string

  newPassword: string

  confirmPassword: string

  audit?: { requestId?: string; ip?: string; userAgent?: string }

}): Promise<SafeUser> {

  const { userId, oldPassword, newPassword, confirmPassword } = input



  if (!oldPassword) throw new Error('请输入旧密码')

  if (!newPassword) throw new Error('请输入新密码')

  if (newPassword.length < 8) throw new Error('密码长度不能少于 8 位')

  if (newPassword !== confirmPassword) throw new Error('两次密码不一致')

  if (newPassword === oldPassword) throw new Error('新密码不能和旧密码相同')



  const user = await findUserById(userId)

  if (!user || !user.enabled) throw new Error('账号不存在或已禁用')



  const valid = await verifyPassword(oldPassword, user.passwordHash)

  if (!valid) throw new Error('旧密码错误')



  const passwordHash = await hashPassword(newPassword)

  const updated = await prisma.user.update({

    where: { id: userId },

    data: {

      passwordHash,

      managedPassword: null,

      mustChangePassword: false,

      passwordChangedAt: new Date(),

    },

  })



  await writeOperationLog({

    userId: input.userId,

    username: input.username,

    role: input.role,

    action: 'change_own_password',

    module: 'auth',

    description: `修改自己的密码 ${input.username}`,

    ip: input.audit?.ip ?? null,

    userAgent: input.audit?.userAgent ?? null,

    requestId: input.audit?.requestId ?? null,

    meta: { targetUserId: userId, targetUsername: input.username },

  })



  return toSafeUser(updated)

}



export async function resetUserPassword(input: {

  actorId: string

  actorUsername: string

  actorRole: string

  targetId: string

  newPassword: string

  confirmPassword: string

  mustChangePassword?: boolean

  audit?: { requestId?: string; ip?: string; userAgent?: string }

}): Promise<AdminUserView> {

  const { targetId, newPassword, confirmPassword } = input



  if (!newPassword) throw new Error('请输入新密码')

  if (newPassword.length < 8) throw new Error('密码长度不能少于 8 位')

  if (newPassword !== confirmPassword) throw new Error('两次密码不一致')



  const target = await findUserById(targetId)

  if (!target) throw new Error('用户不存在')

  assertCanManageUser(
    { id: input.actorId, username: input.actorUsername },
    target,
    'reset_password',
  )

  const mustChange = input.mustChangePassword !== false

  const passwordHash = await hashPassword(newPassword)

  const updated = await prisma.user.update({

    where: { id: targetId },

    data: {

      passwordHash,

      managedPassword: newPassword,

      mustChangePassword: mustChange,

      passwordChangedAt: new Date(),

    },

  })



  await writeOperationLog({

    userId: input.actorId,

    username: input.actorUsername,

    role: input.actorRole,

    action: 'reset_user_password',

    module: 'user',

    description: `重置用户密码 ${target.username}`,

    ip: input.audit?.ip ?? null,

    userAgent: input.audit?.userAgent ?? null,

    requestId: input.audit?.requestId ?? null,

    meta: {

      targetUserId: target.id,

      targetUsername: target.username,

      mustChangePassword: mustChange,

    },

  })



  return toAdminUser(updated)

}



export function toSafeUserFromRecord(user: {

  id: string

  username: string

  role: string

  enabled: boolean

  mustChangePassword: boolean

  passwordChangedAt: Date | null

  lastLoginAt: Date | null

  createdAt: Date

  updatedAt: Date

}): SafeUser {

  return toSafeUser(user)

}

