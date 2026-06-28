import React, { useEffect, useRef, useState } from 'react'
import { ViewportModal } from '../ui/ViewportModal'
import { verifySettingsPassword } from '../../lib/settings-gate'

interface Props {
  open: boolean
  onVerified: () => void
  onCancel: () => void
}

export const SettingsPasswordDialog: React.FC<Props> = ({ open, onVerified, onCancel }) => {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setPassword('')
      setError(null)
      return
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (verifySettingsPassword(password)) {
      setError(null)
      onVerified()
      return
    }
    setError('密码不正确，请重新输入')
  }

  return (
    <ViewportModal
      open={open}
      onClose={onCancel}
      labelledBy="settings-password-title"
      zIndexClass="z-[120]"
      panelClassName="w-full max-w-sm overflow-visible p-6"
      backdropClassName="bg-slate-900/40"
    >
      <div data-testid="settings-password-dialog">
        <h2 id="settings-password-title" className="text-lg font-semibold text-slate-900">
          系统设置验证
        </h2>
        <p className="mt-1 text-sm text-slate-500">请输入管理密码以进入系统设置</p>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            autoComplete="off"
            data-testid="settings-password-input"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error) setError(null)
            }}
            placeholder="请输入密码"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-rose-200 focus:ring-2"
          />
          {error ? (
            <p className="text-xs text-red-600" data-testid="settings-password-error">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              data-testid="settings-password-cancel"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="settings-password-submit"
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
            >
              确认
            </button>
          </div>
        </form>
      </div>
    </ViewportModal>
  )
}
