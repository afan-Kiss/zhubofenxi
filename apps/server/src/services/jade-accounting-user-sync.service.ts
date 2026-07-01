import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import type { UserRole } from '../types/roles'
import { isUserRole } from '../types/roles'
import { logInfo, logWarn } from '../utils/server-log'

const DEFAULT_ACCOUNTING_DB_PATH =
  '/www/wwwroot/jade-accounting/apps/server/prisma/data/accounting.db'

type AccountingUserRow = {
  username: string
  password: string
  status: string
  isActive: number | bigint | boolean
  roles: string | null
}

export type JadeAccountingUserSyncResult = {
  skipped: boolean
  reason?: string
  created: number
  updated: number
  unchanged: number
  errors: string[]
}

function isAccountingUserSyncEnabled(): boolean {
  const raw = process.env.JADE_ACCOUNTING_USER_SYNC_ENABLED?.trim().toLowerCase()
  return raw !== 'false' && raw !== '0'
}

export function resolveJadeAccountingDbPath(): string | null {
  if (!isAccountingUserSyncEnabled()) return null

  const configured = process.env.JADE_ACCOUNTING_DB_PATH?.trim()
  const dbPath = configured
    ? path.isAbsolute(configured)
      ? configured
      : path.resolve(configured)
    : DEFAULT_ACCOUNTING_DB_PATH

  if (!fs.existsSync(dbPath)) {
    if (configured) {
      logWarn('记账用户同步', `记账库不存在：${dbPath}`)
    }
    return null
  }
  return dbPath
}

function isRowActive(row: AccountingUserRow): boolean {
  const activeFlag =
    row.isActive === true ||
    row.isActive === 1 ||
    row.isActive === 1n
  return row.status === 'active' && activeFlag
}

function mapAccountingRoleToZhubo(roles: string | null): UserRole {
  const names = (roles ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (names.includes('管理员')) return 'boss'
  return 'staff'
}

function escapeSqlitePath(dbPath: string): string {
  return dbPath.replace(/'/g, "''")
}

async function fetchAccountingUsers(dbPath: string): Promise<AccountingUserRow[]> {
  const escaped = escapeSqlitePath(path.resolve(dbPath))
  try {
    await prisma.$executeRawUnsafe(`ATTACH DATABASE '${escaped}' AS jade_acc`)
    return await prisma.$queryRawUnsafe<AccountingUserRow[]>(`
      SELECT
        u.username AS username,
        u.password AS password,
        u.status AS status,
        u.isActive AS isActive,
        GROUP_CONCAT(r.name, ',') AS roles
      FROM jade_acc.User u
      LEFT JOIN jade_acc.UserRole ur ON ur.userId = u.id
      LEFT JOIN jade_acc.Role r ON r.id = ur.roleId
      GROUP BY u.id, u.username, u.password, u.status, u.isActive
    `)
  } finally {
    try {
      await prisma.$executeRawUnsafe('DETACH DATABASE jade_acc')
    } catch {
      // ignore detach errors
    }
  }
}

function buildUserPatch(
  existing: { role: string; passwordHash: string; enabled: boolean },
  row: AccountingUserRow,
  targetRole: UserRole,
  enabled: boolean,
): { passwordHash?: string; role?: string; enabled?: boolean } | null {
  const patch: { passwordHash?: string; role?: string; enabled?: boolean } = {}

  if (existing.passwordHash !== row.password) {
    patch.passwordHash = row.password
  }

  if (existing.enabled !== enabled) {
    patch.enabled = enabled
  }

  const existingRole = isUserRole(existing.role) ? existing.role : null

  if (existingRole === 'super_admin') {
    // 超级管理员仅同步密码与启用状态，不改角色
  } else if (existingRole === 'boss') {
    // 已是老板账号时不降级为员工
  } else if (existingRole === 'staff' || existingRole === 'local_viewer') {
    if (existing.role !== targetRole) {
      patch.role = targetRole
    }
  } else if (existing.role !== targetRole) {
    patch.role = targetRole
  }

  return Object.keys(patch).length > 0 ? patch : null
}

export async function syncJadeAccountingUsers(): Promise<JadeAccountingUserSyncResult> {
  const dbPath = resolveJadeAccountingDbPath()
  if (!dbPath) {
    return {
      skipped: true,
      reason: 'disabled_or_missing_db',
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [],
    }
  }

  let rows: AccountingUserRow[]
  try {
    rows = await fetchAccountingUsers(dbPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logWarn('记账用户同步', `读取记账库失败：${msg}`)
    return {
      skipped: true,
      reason: 'read_failed',
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [msg],
    }
  }

  const activeRows = rows.filter(isRowActive)
  let created = 0
  let updated = 0
  let unchanged = 0
  const errors: string[] = []

  for (const row of activeRows) {
    const username = row.username.trim()
    if (!username) continue

    const targetRole = mapAccountingRoleToZhubo(row.roles)
    const enabled = true

    try {
      const existing = await prisma.user.findUnique({ where: { username } })
      if (!existing) {
        await prisma.user.create({
          data: {
            username,
            passwordHash: row.password,
            role: targetRole,
            enabled,
            mustChangePassword: false,
          },
        })
        created++
        continue
      }

      const patch = buildUserPatch(existing, row, targetRole, enabled)
      if (!patch) {
        unchanged++
        continue
      }

      await prisma.user.update({ where: { id: existing.id }, data: patch })
      updated++
    } catch (err) {
      errors.push(`${username}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (created > 0 || updated > 0 || errors.length > 0) {
    logInfo(
      '记账用户同步',
      `完成：新增 ${created}，更新 ${updated}，无变化 ${unchanged}${
        errors.length > 0 ? `，失败 ${errors.length}` : ''
      }`,
    )
  }

  return { skipped: false, created, updated, unchanged, errors }
}
