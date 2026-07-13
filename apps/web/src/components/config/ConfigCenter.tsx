import React from 'react'
import { AnchorManagementPanel } from './AnchorManagementPanel'
import { BoardCheckExportPanel } from './BoardCheckExportPanel'
import { LocalSyncStatusPanel } from './LocalSyncStatusPanel'
import { LiveAccountCookiePanel } from './LiveAccountCookiePanel'
import { PagePermissionPanel } from './PagePermissionPanel'
import { UserManagementPanel } from './UserManagementPanel'
import { useAuth } from '../../providers/AuthProvider'

const SECTIONS: Array<{ id: string; node: React.ReactNode; adminOnly?: boolean }> = [
  { id: 'sync', node: <LocalSyncStatusPanel /> },
  { id: 'cookie', node: <LiveAccountCookiePanel /> },
  { id: 'anchor', node: <AnchorManagementPanel /> },
  { id: 'export', node: <BoardCheckExportPanel /> },
  { id: 'users', node: <UserManagementPanel />, adminOnly: true },
  { id: 'permissions', node: <PagePermissionPanel />, adminOnly: true },
]

export const ConfigCenter: React.FC = () => {
  const { user } = useAuth()
  const isAdmin = user?.role === 'super_admin'

  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || isAdmin)

  return (
    <div className="board-page-enter min-w-0 space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">系统设置</h2>
      <p className="text-xs text-slate-500">
        直播号 Cookie 与经营数据同步。保存后由后台自动同步任务使用。
      </p>

      {visibleSections.map((section, i) => (
        <div
          key={section.id}
          className="board-settings-section"
          style={{ ['--i' as string]: String(i + 1) }}
        >
          {section.node}
        </div>
      ))}
    </div>
  )
}
