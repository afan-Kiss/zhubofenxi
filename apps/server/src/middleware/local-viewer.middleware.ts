import type { NextFunction, Request, Response } from 'express'
import { LOCAL_VIEWER_USER } from '../constants/local-viewer'

/** 为免登录本地看板附加固定身份，不校验会话 */
export function attachLocalViewer(req: Request, _res: Response, next: NextFunction): void {
  req.user = LOCAL_VIEWER_USER
  next()
}
