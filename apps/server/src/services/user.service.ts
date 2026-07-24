import { prisma } from '../lib/prisma'

import type { UserRole } from '../types/roles'

import { isUserRole } from '../types/roles'

import { hashPassword, verifyPassword } from '../utils/password'

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

  registeredIp: string | null

  registeredUserAgent: string | null

  lastLoginIp: string | null

  lastLoginUserAgent: string | null

}): AdminUserView {

  return {

    ...toSafeUser(user),

    managedPassword: user.managedPassword,

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

  registration?: { ip?: string | null; userAgent?: string | null }

}): Promise<AdminUserView> {

  const exists = await prisma.user.findUnique({ where: { username: input.username } })

  if (exists) throw new Error('用户名已存在')



  const passwordHash = await hashPassword(input.password)

  const user = await prisma.user.create({

    data: {

      username: input.username.trim(),

      passwordHash,

      managedPassword: input.password,

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



export async function updateUser(

  id: string,

  patch: { role?: UserRole; enabled?: boolean },

): Promise<SafeUser> {

  const data: { role?: string; enabled?: boolean } = {}



  if (patch.role !== undefined) data.role = patch.role

  if (patch.enabled !== undefined) data.enabled = patch.enabled



  const user = await prisma.user.update({ where: { id }, data })

  return toSafeUser(user)

}



export async function disableUser(id: string): Promise<SafeUser> {

  return updateUser(id, { enabled: false })

}



export async function recordUserLogin(

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

/** 会话期内打开应用时刷新最近登录；默认 30 分钟节流，避免每次 /me 写库 */
const LAST_LOGIN_STALE_MS = 30 * 60 * 1000

export async function recordUserLoginIfStale(

  userId: string,

  client?: { ip?: string | null; userAgent?: string | null },

  staleMs: number = LAST_LOGIN_STALE_MS,

): Promise<void> {

  const row = await prisma.user.findUnique({

    where: { id: userId },

    select: { lastLoginAt: true },

  })

  if (!row) return

  if (row.lastLoginAt && Date.now() - row.lastLoginAt.getTime() < staleMs) return

  await recordUserLogin(userId, client)

}



export async function touchLastLogin(userId: string): Promise<void> {

  await recordUserLogin(userId)

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

