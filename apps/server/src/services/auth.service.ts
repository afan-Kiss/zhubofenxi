import { getAuthMode } from '../config/env'
import { LOCAL_VIEWER_USER } from '../constants/local-viewer'
import type { SessionUser } from '../types/auth'
import type { UserRole } from '../types/roles'
import { getClientIp } from '../middleware/audit.middleware'
import type { Request } from 'express'
import {
  createSession,
  deleteSessionByToken,
  resolveUserFromSessionToken,
  SESSION_COOKIE_NAME,
} from './session.service'
import { writeOperationLog } from './audit.service'
import {
  changeOwnPassword,
  createUser,
  findUserById,
  findUserByUsername,
  toSafeUserFromRecord,
  recordUserLogin,
  recordUserLoginIfStale,
  type SafeUser,
} from './user.service'
import { verifyPassword } from '../utils/password'
import { getEffectivePagePermissionsForRole } from './page-permission.service'
import type { PagePermissionKey } from '../config/page-permissions'

export async function resolveRequestUser(req: Request): Promise<SessionUser | null> {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  if (token && typeof token === 'string') {
    const user = await resolveUserFromSessionToken(token)
    if (user) return user
  }
  if (getAuthMode() === 'local') {
    return LOCAL_VIEWER_USER
  }
  return null
}

export async function loginUser(input: {
  username: string
  password: string
  audit?: { requestId?: string; ip?: string; userAgent?: string }
}): Promise<{ user: SafeUser; token: string }> {
  const username = input.username.trim()
  const password = input.password
  if (!username || !password) {
    throw new Error('请填写账号和密码')
  }

  const row = await findUserByUsername(username)
  if (!row || !row.enabled) {
    await writeOperationLog({
      username,
      role: 'staff',
      action: 'login_failed',
      module: 'auth',
      description: `登录失败：${username}`,
      ip: input.audit?.ip ?? null,
      userAgent: input.audit?.userAgent ?? null,
      requestId: input.audit?.requestId ?? null,
    })
    throw new Error('账号或密码不正确')
  }

  const valid = await verifyPassword(password, row.passwordHash)
  if (!valid) {
    await writeOperationLog({
      userId: row.id,
      username: row.username,
      role: row.role,
      action: 'login_failed',
      module: 'auth',
      description: `登录失败：${username}`,
      ip: input.audit?.ip ?? null,
      userAgent: input.audit?.userAgent ?? null,
      requestId: input.audit?.requestId ?? null,
    })
    throw new Error('账号或密码不正确')
  }

  const { token } = await createSession(row.id)
  await recordUserLogin(row.id, {
    ip: input.audit?.ip,
    userAgent: input.audit?.userAgent,
  })
  // 必须重新读取：recordUserLogin 之后再用旧 row 会返回过期的 lastLoginAt
  const fresh = await findUserById(row.id)
  if (!fresh) throw new Error('账号不存在')
  const user = toSafeUserFromRecord(fresh)

  await writeOperationLog({
    userId: row.id,
    username: row.username,
    role: row.role,
    action: 'login_success',
    module: 'auth',
    description: `登录成功：${username}`,
    ip: input.audit?.ip ?? null,
    userAgent: input.audit?.userAgent ?? null,
    requestId: input.audit?.requestId ?? null,
  })

  return { user, token }
}

export async function registerUser(input: {
  username: string
  password: string
  confirmPassword: string
  registration?: { ip?: string | null; userAgent?: string | null }
}): Promise<SafeUser> {
  const username = input.username.trim()
  if (username.length < 3) throw new Error('用户名至少 3 个字符')
  if (input.password.length < 8) throw new Error('密码长度不能少于 8 位')
  if (input.password !== input.confirmPassword) throw new Error('两次密码不一致')
  return createUser({
    username,
    password: input.password,
    role: 'staff',
    registration: input.registration,
  })
}

export async function logoutUser(token: string | undefined): Promise<void> {
  if (token && typeof token === 'string') {
    await deleteSessionByToken(token)
  }
}

export async function buildAuthMePayload(
  user: SessionUser,
  client?: { ip?: string | null; userAgent?: string | null },
): Promise<{
  user: SafeUser | {
    id: string
    username: string
    role: UserRole
    name?: string
    enabled: boolean
    mustChangePassword: boolean
    passwordChangedAt: string | null
    lastLoginAt: string | null
    createdAt: string
    updatedAt: string
  }
  mode: 'session' | 'local'
  permissions: Record<PagePermissionKey, boolean>
}> {
  const mode = getAuthMode()
  const permissions = await getEffectivePagePermissionsForRole(user.role)

  if (user.id === LOCAL_VIEWER_USER.id) {
    return {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name ?? '本地看板',
        enabled: true,
        mustChangePassword: false,
        passwordChangedAt: null,
        lastLoginAt: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      mode: 'local',
      permissions,
    }
  }

  // 会话可续 7 天：打开应用时节流刷新最近登录，避免账号管理长期显示过期时间
  await recordUserLoginIfStale(user.id, client)

  const row = await findUserById(user.id)
  if (!row) {
    throw new Error('账号不存在')
  }
  const safe = toSafeUserFromRecord(row)
  return {
    user: {
      ...safe,
      passwordChangedAt: safe.passwordChangedAt?.toISOString() ?? null,
      lastLoginAt: safe.lastLoginAt?.toISOString() ?? null,
      createdAt: safe.createdAt.toISOString(),
      updatedAt: safe.updatedAt.toISOString(),
    },
    mode: 'session',
    permissions,
  }
}

export function authAuditFromRequest(req: Request) {
  return {
    requestId: req.requestId,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] ?? undefined,
  }
}

export { changeOwnPassword }