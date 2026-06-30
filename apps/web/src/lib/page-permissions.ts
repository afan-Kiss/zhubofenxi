export const PAGE_PERMISSION_KEYS = [
  'overview',
  'anchors',
  'buyers',
  'operations_report',
  'good_reviews',
  'settings',
] as const

export type PagePermissionKey = (typeof PAGE_PERMISSION_KEYS)[number]

export const PAGE_PERMISSION_LABELS: Record<PagePermissionKey, string> = {
  overview: '经营总览',
  anchors: '主播业绩',
  buyers: '买家排行',
  operations_report: '运营报表',
  good_reviews: '好评中心',
  settings: '系统设置',
}

export const PAGE_PERMISSION_ROUTES: Record<PagePermissionKey, string> = {
  overview: '/',
  anchors: '/anchors',
  buyers: '/buyers',
  operations_report: '/operations-report',
  good_reviews: '/good-reviews',
  settings: '/settings',
}

export type RolePagePermissions = Record<
  string,
  Record<PagePermissionKey, boolean>
>

export type EditableRolePagePermissions = Pick<
  Record<'boss' | 'staff', Record<PagePermissionKey, boolean>>,
  'boss' | 'staff'
>

export interface AuthUser {
  id: string
  username: string
  role: string
  name?: string
  enabled: boolean
  mustChangePassword: boolean
}

export interface AuthMePayload {
  user: AuthUser & {
    passwordChangedAt: string | null
    lastLoginAt: string | null
    createdAt: string
    updatedAt: string
  }
  mode: 'session' | 'local'
  permissions: Record<PagePermissionKey, boolean>
}
