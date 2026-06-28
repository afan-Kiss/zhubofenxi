import React, { useState } from 'react'
import { isSettingsUnlocked, unlockSettings } from '../../lib/settings-gate'
import { useAuth } from '../../providers/AuthProvider'
import { SettingsPasswordDialog } from './SettingsPasswordDialog'

interface Props {
  children: React.ReactNode
}

export const SettingsGate: React.FC<Props> = ({ children }) => {
  const { mode, canAccess } = useAuth()
  const sessionUnlocked = mode === 'session' && canAccess('settings')
  const [unlocked, setUnlocked] = useState(() => sessionUnlocked || isSettingsUnlocked())
  const [dialogOpen, setDialogOpen] = useState(() => !sessionUnlocked && !isSettingsUnlocked())

  if (sessionUnlocked || unlocked) {
    return <div data-testid="settings-page-unlocked">{children}</div>
  }

  return (
    <>
      <div
        className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center"
        data-testid="settings-page-locked"
      >
        <p className="text-sm text-slate-600">系统设置已锁定，请输入管理密码后查看。</p>
        <button
          type="button"
          data-testid="settings-unlock-button"
          onClick={() => setDialogOpen(true)}
          className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
        >
          输入密码
        </button>
      </div>
      <SettingsPasswordDialog
        open={dialogOpen}
        onVerified={() => {
          unlockSettings()
          setUnlocked(true)
          setDialogOpen(false)
        }}
        onCancel={() => setDialogOpen(false)}
      />
    </>
  )
}
