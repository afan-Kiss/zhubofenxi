export const USER_ROLES = ['super_admin', 'boss', 'staff', 'local_viewer'] as const

export type UserRole = (typeof USER_ROLES)[number]

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value)
}

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: '超级管理员',
  boss: '老板',
  staff: '员工',
  local_viewer: '本地看板',
}
