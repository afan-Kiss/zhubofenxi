import type { UserRole } from './roles'

export interface SessionUser {
  id: string
  username: string
  role: UserRole
  name?: string
}
