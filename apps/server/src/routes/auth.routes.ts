import { Router } from 'express'
import { LOCAL_VIEWER_USER } from '../constants/local-viewer'
import { sendFail, sendOk } from '../utils/response'

export const authRouter = Router()

const GONE_MESSAGE = '账号登录功能已停用，请直接使用本地经营看板。'

authRouter.post('/register', (_req, res) => {
  sendFail(res, GONE_MESSAGE, 410)
})

authRouter.post('/login', (_req, res) => {
  sendFail(res, GONE_MESSAGE, 410)
})

authRouter.post('/logout', (_req, res) => {
  sendFail(res, GONE_MESSAGE, 410)
})

authRouter.get('/me', (_req, res) => {
  sendOk(res, {
    user: {
      id: LOCAL_VIEWER_USER.id,
      username: LOCAL_VIEWER_USER.username,
      role: LOCAL_VIEWER_USER.role,
      name: LOCAL_VIEWER_USER.name ?? '本地看板',
      enabled: true,
      mustChangePassword: false,
      passwordChangedAt: null,
      lastLoginAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    mode: 'local_viewer',
  })
})

authRouter.post('/change-password', (_req, res) => {
  sendFail(res, GONE_MESSAGE, 410)
})
