import type { UserRole } from '../types/roles'

/** 主菜单页面权限键（与前端路由一致） */
export const PAGE_PERMISSION_KEYS = [
  'overview',
  'anchors',
  'buyers',
  'lucky_gifts',
  'operations_report',
  'good_reviews',
  'boss_dashboard',
  'settings',
] as const

export type PagePermissionKey = (typeof PAGE_PERMISSION_KEYS)[number]

export const PAGE_PERMISSION_LABELS: Record<PagePermissionKey, string> = {
  overview: '经营总览',
  anchors: '主播业绩',
  buyers: '买家排行',
  lucky_gifts: '福袋发货',
  operations_report: '运营报表',
  good_reviews: '好评中心',
  boss_dashboard: '老板查看',
  settings: '系统设置',
}

export type RolePagePermissions = Record<UserRole, Record<PagePermissionKey, boolean>>

const ALL_TRUE: Record<PagePermissionKey, boolean> = {
  overview: true,
  anchors: true,
  buyers: true,
  lucky_gifts: true,
  operations_report: true,
  good_reviews: true,
  boss_dashboard: true,
  settings: true,
}

export const DEFAULT_ROLE_PAGE_PERMISSIONS: RolePagePermissions = {
  super_admin: { ...ALL_TRUE },
  boss: {
    overview: true,
    anchors: true,
    buyers: true,
    lucky_gifts: true,
    operations_report: true,
    good_reviews: true,
    boss_dashboard: true,
    settings: false,
  },
  staff: {
    overview: true,
    anchors: true,
    buyers: true,
    lucky_gifts: true,
    operations_report: false,
    good_reviews: true,
    boss_dashboard: false,
    settings: false,
  },
  local_viewer: { ...ALL_TRUE },
}

export function normalizeRolePagePermissions(raw: unknown): RolePagePermissions {
  const base = structuredClone(DEFAULT_ROLE_PAGE_PERMISSIONS)
  if (!raw || typeof raw !== 'object') return base
  const input = raw as Partial<Record<UserRole, Partial<Record<PagePermissionKey, unknown>>>>
  for (const role of Object.keys(base) as UserRole[]) {
    const row = input[role]
    if (!row || typeof row !== 'object') continue
    for (const key of PAGE_PERMISSION_KEYS) {
      if (typeof row[key] === 'boolean') {
        base[role][key] = row[key]
      }
    }
  }
  return base
}

/** 设置页可编辑的角色（仅合并 boss / staff，不覆盖 super_admin / local_viewer） */
export const EDITABLE_PAGE_PERMISSION_ROLES = ['boss', 'staff'] as const satisfies readonly UserRole[]

export function mergeEditableRolePagePermissions(
  existing: RolePagePermissions,
  patch: unknown,
): RolePagePermissions {
  const merged = structuredClone(existing)
  if (!patch || typeof patch !== 'object') return merged
  const input = patch as Partial<Record<UserRole, Partial<Record<PagePermissionKey, unknown>>>>
  for (const role of EDITABLE_PAGE_PERMISSION_ROLES) {
    const row = input[role]
    if (!row || typeof row !== 'object') continue
    for (const key of PAGE_PERMISSION_KEYS) {
      if (typeof row[key] === 'boolean') {
        merged[role][key] = row[key]
      }
    }
  }
  return merged
}

export function resolveEffectivePagePermissions(
  role: UserRole,
  matrix: RolePagePermissions,
): Record<PagePermissionKey, boolean> {
  if (role === 'super_admin' || role === 'local_viewer') {
    return { ...ALL_TRUE }
  }
  return { ...matrix[role] }
}
