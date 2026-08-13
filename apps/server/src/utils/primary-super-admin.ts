/** 系统最高权限账号（可管理/停用/删除含 admin 在内的任意用户） */
export const PRIMARY_SUPER_ADMIN_USERNAME = 'fanfan'

export function isPrimarySuperAdminUsername(username: string | null | undefined): boolean {
  return String(username ?? '').trim() === PRIMARY_SUPER_ADMIN_USERNAME
}
