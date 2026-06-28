import type { NextFunction, Request, Response } from 'express'
import { resolveRequestUser } from '../services/auth.service'

/** 解析当前请求用户（登录会话或本地免登录模式） */
export function attachRequestUser(req: Request, _res: Response, next: NextFunction): void {
  void resolveRequestUser(req)
    .then((user) => {
      if (user) req.user = user
      next()
    })
    .catch(next)
}

/** @deprecated 使用 attachRequestUser */
export const attachLocalViewer = attachRequestUser
