export const PAGE_PERMISSION_KEYS = [
  'overview',
  'anchors',
  'buyers',
  'lucky_gifts',
  'operations_report',
  'good_reviews',
  'refund_analysis',
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
  refund_analysis: '退款分析',
  boss_dashboard: '老板查看',
  settings: '系统设置',
}

export const PAGE_PERMISSION_ROUTES: Record<PagePermissionKey, string> = {
  overview: '/',
  anchors: '/anchors',
  buyers: '/buyers',
  lucky_gifts: '/lucky-gifts',
  operations_report: '/operations-report',
  good_reviews: '/good-reviews',
  refund_analysis: '/refund-analysis',
  boss_dashboard: '/boss-dashboard',
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
