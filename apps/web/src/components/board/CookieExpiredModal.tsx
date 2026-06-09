import React from 'react'
import { useNavigate } from 'react-router-dom'
import type { LiveAccountPublic } from '../../lib/live-account'

interface Props {
  open: boolean
  accounts: LiveAccountPublic[]
  onDismiss: () => void
}

export const CookieExpiredModal: React.FC<Props> = ({ open, accounts, onDismiss }) => {
  const navigate = useNavigate()
  if (!open || accounts.length === 0) return null

  const single = accounts.length === 1

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-expired-title"
      >
        <h3 id="cookie-expired-title" className="text-base font-semibold text-slate-900">
          直播号 Cookie 已失效
        </h3>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          {single ? (
            <p>
              直播号「{accounts[0]!.name}」Cookie 已失效，该直播号本轮数据未能更新。当前页面仍展示最近一次成功同步的数据，请到系统设置更新 Cookie 后重新同步。
            </p>
          ) : (
            <>
              <p>以下直播号 Cookie 已失效，本轮数据未能更新：</p>
              <ul className="list-disc space-y-1 pl-5">
                {accounts.map((a) => (
                  <li key={a.id}>{a.name}</li>
                ))}
              </ul>
              <p>
                当前页面仍展示最近一次成功同步的数据，请到系统设置更新 Cookie 后重新同步。
              </p>
            </>
          )}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            稍后处理
          </button>
          <button
            type="button"
            onClick={() => {
              onDismiss()
              navigate('/settings#live-account-cookie')
            }}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
          >
            去更新 Cookie
          </button>
        </div>
      </div>
    </div>
  )
}
