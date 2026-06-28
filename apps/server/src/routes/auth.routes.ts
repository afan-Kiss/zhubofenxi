import { Router } from 'express'
import { getAuthMode, getSessionCookieOptions } from '../config/env'
import { getClientIp } from '../middleware/audit.middleware'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import {
  authAuditFromRequest,
  buildAuthMePayload,
  changeOwnPassword,
  loginUser,
  logoutUser,
  registerUser,
  resolveRequestUser,
} from '../services/auth.service'
import {
  getRolePagePermissions,
  saveRolePagePermissions,
} from '../services/page-permission.service'
import { isRegistrationEnabled } from '../config/env'
import { sendFail, sendOk } from '../utils/response'
import { SESSION_COOKIE_NAME } from '../services/session.service'

export const authRouter = Router()

authRouter.get('/mode', (_req, res) => {
  sendOk(res, { mode: getAuthMode(), allowRegister: isRegistrationEnabled() })
})

authRouter.post('/register', async (req, res) => {
  if (!isRegistrationEnabled()) {
    sendFail(res, '当前未开放注册，请联系管理员', 403)
    return
  }
  try {
    const user = await registerUser({
      username: String(req.body?.username ?? ''),
      password: String(req.body?.password ?? ''),
      confirmPassword: String(req.body?.confirmPassword ?? ''),
      registration: authAuditFromRequest(req),
    })
    sendOk(
      res,
      {
        message: '注册成功，请登录',
        user: {
          ...user,
          passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
      },
      201,
    )
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '注册失败')
  }
})

authRouter.post('/login', async (req, res) => {
  try {
    const { user, token } = await loginUser({
      username: String(req.body?.username ?? ''),
      password: String(req.body?.password ?? ''),
      audit: authAuditFromRequest(req),
    })
    res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions())
    sendOk(res, {
      message: '登录成功',
      user: {
        ...user,
        passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '登录失败', 401)
  }
})

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  await logoutUser(typeof token === 'string' ? token : undefined)
  res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions())
  sendOk(res, { message: '已退出登录' })
})

authRouter.get('/me', async (req, res) => {
  try {
    const user = await resolveRequestUser(req)
    if (!user) {
      sendFail(res, '请先登录', 401)
      return
    }
    sendOk(res, await buildAuthMePayload(user))
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '读取登录状态失败', 500)
  }
})

authRouter.post('/change-password', requireAuth, async (req, res) => {
  try {
    const user = await changeOwnPassword({
      userId: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      oldPassword: String(req.body?.oldPassword ?? ''),
      newPassword: String(req.body?.newPassword ?? ''),
      confirmPassword: String(req.body?.confirmPassword ?? ''),
      audit: authAuditFromRequest(req),
    })
    sendOk(res, {
      message: '密码已修改',
      user: {
        ...user,
        passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '修改密码失败')
  }
})

authRouter.get('/page-permissions', attachRequestUser, requireAuth, async (req, res) => {
  if (req.user!.role !== 'super_admin') {
    sendFail(res, '仅管理员可查看页面权限配置', 403)
    return
  }
  try {
    sendOk(res, await getRolePagePermissions())
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '读取页面权限失败', 500)
  }
})

authRouter.put('/page-permissions', attachRequestUser, requireAuth, async (req, res) => {
  if (req.user!.role !== 'super_admin') {
    sendFail(res, '仅管理员可修改页面权限', 403)
    return
  }
  try {
    const saved = await saveRolePagePermissions(req.body)
    sendOk(res, saved)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '保存页面权限失败', 500)
  }
})
