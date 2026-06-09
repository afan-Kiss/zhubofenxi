import React from 'react'
import { AnchorManagementPanel } from './AnchorManagementPanel'
import { BoardCheckExportPanel } from './BoardCheckExportPanel'
import { LocalSyncStatusPanel } from './LocalSyncStatusPanel'
import { LiveAccountCookiePanel } from './LiveAccountCookiePanel'
import { AppFaviconPanel } from './AppFaviconPanel'
import { BusinessDataMaintenancePanel } from './BusinessDataMaintenancePanel'
import { CookieHealthBanner } from '../board/CookieHealthBanner'
import { useBoardLiveQuery } from '../../providers/BoardLiveQueryProvider'

const SECTIONS: Array<{ id: string; node: React.ReactNode }> = [
  { id: 'sync', node: <LocalSyncStatusPanel /> },
  { id: 'favicon', node: <AppFaviconPanel /> },
  { id: 'cookie', node: <LiveAccountCookiePanel /> },
  { id: 'maintain', node: <BusinessDataMaintenancePanel /> },
  { id: 'anchor', node: <AnchorManagementPanel /> },
  { id: 'export', node: <BoardCheckExportPanel /> },
]

export const ConfigCenter: React.FC = () => {
  const { cookieHealth } = useBoardLiveQuery()

  return (
    <div className="board-page-enter min-w-0 space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">系统设置</h2>
      <p className="text-xs text-slate-500">
        本地经营看板配置。接口 Cookie 保存在本机服务端；保存后由后台自动同步任务使用，页面不会手动触发同步。
      </p>

      <div className="board-settings-section" style={{ ['--i' as string]: '0' }}>
        <CookieHealthBanner cookieHealth={cookieHealth} />
      </div>

      {SECTIONS.map((section, i) => (
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

