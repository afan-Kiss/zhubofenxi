import type { Response } from 'express'
import { sendFail } from './response'

/** 已下线接口：返回 410，避免误用本地库/快照旧链路 */
export function sendDeprecatedApi(res: Response, message: string): void {
  sendFail(res, message, 410)
}
