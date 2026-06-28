import {
  DEFAULT_ROLE_PAGE_PERMISSIONS,
  mergeEditableRolePagePermissions,
  normalizeRolePagePermissions,
  resolveEffectivePagePermissions,
  type PagePermissionKey,
  type RolePagePermissions,
} from '../config/page-permissions'
import type { UserRole } from '../types/roles'
import { getSetting, setSetting } from './system-setting.service'

const STORAGE_KEY = 'role_page_permissions_v1'

function extractMatrixPayload(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input
  if ('matrix' in input && (input as { matrix?: unknown }).matrix != null) {
    return (input as { matrix: unknown }).matrix
  }
  return input
}

export async function getRolePagePermissions(): Promise<RolePagePermissions> {
  const raw = await getSetting(STORAGE_KEY)
  if (!raw) return structuredClone(DEFAULT_ROLE_PAGE_PERMISSIONS)
  try {
    return normalizeRolePagePermissions(JSON.parse(raw))
  } catch {
    return structuredClone(DEFAULT_ROLE_PAGE_PERMISSIONS)
  }
}

export async function saveRolePagePermissions(input: unknown): Promise<RolePagePermissions> {
  const existing = await getRolePagePermissions()
  const patch = extractMatrixPayload(input)
  const normalized = mergeEditableRolePagePermissions(existing, patch)
  await setSetting(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export async function getEffectivePagePermissionsForRole(
  role: UserRole,
): Promise<Record<PagePermissionKey, boolean>> {
  const matrix = await getRolePagePermissions()
  return resolveEffectivePagePermissions(role, matrix)
}

export async function ensureDefaultPagePermissions(): Promise<void> {
  const existing = await getSetting(STORAGE_KEY)
  if (existing == null) {
    await setSetting(STORAGE_KEY, JSON.stringify(DEFAULT_ROLE_PAGE_PERMISSIONS))
  }
}
