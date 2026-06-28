/**
 * 页面权限保存验收
 * 用法: npx tsx apps/server/scripts/page-permission-acceptance.ts
 */
import {
  DEFAULT_ROLE_PAGE_PERMISSIONS,
  mergeEditableRolePagePermissions,
  resolveEffectivePagePermissions,
} from '../src/config/page-permissions'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function main() {
  const issues: string[] = []
  const base = structuredClone(DEFAULT_ROLE_PAGE_PERMISSIONS)

  const saved = mergeEditableRolePagePermissions(base, {
    staff: { ...base.staff, buyers: false, operations_report: false },
  })
  assert(saved.staff.buyers === false, '员工 buyers 取消后应为 false', issues)
  assert(saved.staff.overview === true, '员工 overview 未改应保持 true', issues)
  assert(saved.boss.operations_report === true, '老板权限不应被误改', issues)

  const again = mergeEditableRolePagePermissions(saved, {
    staff: { buyers: true },
  })
  assert(again.staff.buyers === true, '员工 buyers 勾选后应为 true', issues)

  const adminPerms = resolveEffectivePagePermissions('super_admin', {
    ...base,
    super_admin: { ...base.super_admin, overview: false },
  })
  assert(adminPerms.overview === true, '管理员应始终拥有全部页面权限', issues)

  if (issues.length > 0) {
    console.error('[page-permission-acceptance] FAIL')
    for (const issue of issues) console.error(' -', issue)
    process.exit(1)
  }
  console.log('[page-permission-acceptance] OK')
}

main()
