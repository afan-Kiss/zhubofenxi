import type { Response } from 'express'

export interface ApiSuccess<T> {
  ok: true
  data: T
}

export interface ApiFailure {
  ok: false
  message: string
}

export function sendOk<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ ok: true, success: true, data } satisfies ApiSuccess<T> & { success: true })
}

export function sendFail(res: Response, message: string, status = 400): void {
  res.status(status).json({ ok: false, success: false, message } satisfies ApiFailure & { success: false })
}
