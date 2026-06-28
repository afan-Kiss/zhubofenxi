import { Router } from 'express'
import { getClientIp } from '../middleware/audit.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import {
  createUser,
  disableUser,
  listUsers,
  resetUserPassword,
  updateUser,
  type AdminUserView,
} from '../services/user.service'
import type { UserRole } from '../types/roles'
import { isUserRole } from '../types/roles'
import { sendFail, sendOk } from '../utils/response'
import { formatClientInfo, formatUserAgentLabel } from '../utils/user-agent-label'

export const userRouter = Router()

userRouter.use(requireAuth, requireRole('super_admin'))

function serializeAdminUser(u: AdminUserView) {
  return {
    ...u,
    managedPassword: u.managedPassword,
    registeredIp: u.registeredIp,
    registeredUserAgent: u.registeredUserAgent,
    registeredClientLabel: formatUserAgentLabel(u.registeredUserAgent),
    registeredClientInfo: formatClientInfo({
      ip: u.registeredIp,
      userAgent: u.registeredUserAgent,
    }),
    lastLoginIp: u.lastLoginIp,
    lastLoginUserAgent: u.lastLoginUserAgent,
    lastLoginClientLabel: formatUserAgentLabel(u.lastLoginUserAgent),
    lastLoginClientInfo: formatClientInfo({
      ip: u.lastLoginIp,
      userAgent: u.lastLoginUserAgent,
    }),
    passwordChangedAt: u.passwordChangedAt?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  }
}

userRouter.get('/', async (_req, res) => {
  try {
    const users = await listUsers()
    sendOk(res, users.map(serializeAdminUser))
  } catch {
    sendFail(res, '获取用户列表失败', 500)
  }
})

userRouter.post('/', async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  const role = String(req.body?.role ?? '')

  if (!username || !password) {
    sendFail(res, '请填写用户名和密码')
    return
  }
  if (!isUserRole(role)) {
    sendFail(res, '角色无效')
    return
  }
  if (password.length < 8) {
    sendFail(res, '密码长度不能少于 8 位')
    return
  }

  try {
    const user = await createUser({
      username,
      password,
      role,
      registration: {
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'] ?? undefined,
      },
    })
    sendOk(res, serializeAdminUser(user), 201)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '创建用户失败')
  }
})

userRouter.patch('/:id/password', async (req, res) => {
  const { id } = req.params
  const newPassword = String(req.body?.newPassword ?? '')
  const confirmPassword = String(req.body?.confirmPassword ?? '')
  const mustChangePassword =
    req.body?.mustChangePassword !== undefined ? Boolean(req.body.mustChangePassword) : true

  try {
    const user = await resetUserPassword({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      targetId: id,
      newPassword,
      confirmPassword,
      mustChangePassword,
      audit: {
        requestId: req.requestId,
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'] ?? undefined,
      },
    })
    sendOk(res, {
      message: '密码已修改',
      user: serializeAdminUser(user),
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '重置密码失败')
  }
})

userRouter.patch('/:id', async (req, res) => {
  const { id } = req.params
  const patch: { role?: UserRole; enabled?: boolean } = {}

  if (req.body?.role !== undefined) {
    if (!isUserRole(String(req.body.role))) {
      sendFail(res, '角色无效')
      return
    }
    patch.role = req.body.role
  }
  if (req.body?.enabled !== undefined) {
    patch.enabled = Boolean(req.body.enabled)
  }

  try {
    const user = await updateUser(id, patch)
    sendOk(res, {
      ...user,
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    })
  } catch {
    sendFail(res, '更新用户失败', 500)
  }
})

userRouter.patch('/:id/disable', async (req, res) => {
  const { id } = req.params
  const current = req.user!
  if (current.id === id) {
    sendFail(res, '不能禁用当前登录账号')
    return
  }

  try {
    const user = await disableUser(id)
    sendOk(res, {
      ...user,
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    })
  } catch {
    sendFail(res, '禁用用户失败', 500)
  }
})
