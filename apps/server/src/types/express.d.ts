import type { SessionUser } from './auth'

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

export {}
