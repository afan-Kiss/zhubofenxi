import type { UserRole } from '../types/roles'
import { getAnchorConfigSync } from './anchor.service'
import { viewMatchesBuyerKey } from './buyer-identity.service'
import type { AnalyzedOrderView } from '../types/analysis'

export type StaffAnchorScope =
  | { kind: 'all' }
  | { kind: 'anchor'; anchorId: string; anchorName: string }
  | { kind: 'unbound' }

export const STAFF_UNBOUND_MESSAGE = '当前账号尚未绑定主播，请联系管理员配置。'

export function resolveStaffAnchorScope(role: UserRole, username: string): StaffAnchorScope {
  if (role === 'local_viewer' || role === 'super_admin' || role === 'boss') {
    return { kind: 'all' }
  }
  if (role !== 'staff') {
    return { kind: 'unbound' }
  }
  const login = username.trim()
  if (!login) return { kind: 'unbound' }

  const config = getAnchorConfigSync()
  for (const a of config.anchors) {
    if (!a.enabled) continue
    if (a.name === login) {
      return { kind: 'anchor', anchorId: a.id, anchorName: a.name }
    }
    const ext = a.externalId?.trim()
    if (ext && ext === login) {
      return { kind: 'anchor', anchorId: a.id, anchorName: a.name }
    }
  }
  return { kind: 'unbound' }
}

export function staffAnchorFilter(role: UserRole, username: string): string | undefined {
  const scope = resolveStaffAnchorScope(role, username)
  return scope.kind === 'anchor' ? scope.anchorName : undefined
}

export function isStaffUnbound(role: UserRole, username: string): boolean {
  return resolveStaffAnchorScope(role, username).kind === 'unbound'
}

export function assertStaffAnchorAccess(
  role: UserRole,
  username: string,
  anchorId?: string,
  anchorName?: string,
): void {
  const scope = resolveStaffAnchorScope(role, username)
  if (scope.kind === 'all') return
  if (scope.kind === 'unbound') {
    throw new Error(STAFF_UNBOUND_MESSAGE)
  }
  if (anchorId && anchorId !== scope.anchorId) {
    throw new Error('无权查看该主播数据')
  }
  if (anchorName && anchorName !== '全部' && anchorName !== scope.anchorName) {
    throw new Error('无权查看该主播数据')
  }
}

export function applyStaffAnchorQuery<T extends { anchorId?: string; anchorName?: string }>(
  role: UserRole,
  username: string,
  query: T,
): T {
  const scope = resolveStaffAnchorScope(role, username)
  if (scope.kind !== 'anchor') return query
  return {
    ...query,
    anchorId: scope.anchorId,
    anchorName: scope.anchorName,
  }
}

export function filterViewsForStaffScope<
  T extends { anchorId?: string; anchorName?: string },
>(views: T[], role: UserRole, username: string): T[] {
  const scope = resolveStaffAnchorScope(role, username)
  if (scope.kind === 'all') return views
  if (scope.kind === 'unbound') return []
  return views.filter(
    (v) => v.anchorId === scope.anchorId || v.anchorName === scope.anchorName,
  )
}

export function staffScopeMeta(role: UserRole, username: string): Record<string, unknown> {
  const scope = resolveStaffAnchorScope(role, username)
  if (scope.kind === 'all') {
    return { staffAnchorScope: { mode: 'all' } }
  }
  if (scope.kind === 'unbound') {
    return {
      staffAnchorScope: { mode: 'unbound', message: STAFF_UNBOUND_MESSAGE },
      staffUnbound: true,
      message: STAFF_UNBOUND_MESSAGE,
    }
  }
  return {
    staffAnchorScope: {
      mode: 'anchor',
      anchorId: scope.anchorId,
      anchorName: scope.anchorName,
    },
    forcedAnchorName: scope.anchorName,
    forcedAnchorId: scope.anchorId,
  }
}

export function assertStaffBuyerKeyAccess(
  role: UserRole,
  username: string,
  buyerKey: string,
  views: AnalyzedOrderView[],
): void {
  const scope = resolveStaffAnchorScope(role, username)
  if (scope.kind === 'all') return
  if (scope.kind === 'unbound') {
    throw new Error(STAFF_UNBOUND_MESSAGE)
  }
  const allowed = views.some(
    (v) =>
      (v.anchorId === scope.anchorId || v.anchorName === scope.anchorName) &&
      viewMatchesBuyerKey(v, buyerKey),
  )
  if (!allowed) {
    throw new Error('无权查看该买家数据')
  }
}
