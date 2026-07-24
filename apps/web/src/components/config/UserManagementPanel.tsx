import React, { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { apiRequest } from '../../lib/api'

interface UserRow {
  id: string
  username: string
  role: string
  enabled: boolean
  managedPassword: string | null
  createdAt: string
  lastLoginAt: string | null
  registeredClientInfo: string
  registeredClientLabel: string
  lastLoginClientInfo: string
  lastLoginClientLabel: string
}

const ROLE_OPTIONS = [
  { value: 'boss', label: '老板' },
  { value: 'staff', label: '员工' },
  { value: 'super_admin', label: '管理员' },
]

const ROLE_LABEL: Record<string, string> = {
  super_admin: '管理员',
  boss: '老板',
  staff: '员工',
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  // 与经营口径一致：固定 Asia/Shanghai，避免浏览器/系统时区导致偏差
  return d.toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export const UserManagementPanel: React.FC = () => {
  const [users, setUsers] = useState<UserRow[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('staff')
  const [message, setMessage] = useState('')
  const [hidePasswords, setHidePasswords] = useState(false)
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')

  const load = async () => {
    const rows = await apiRequest<UserRow[]>('/api/users')
    setUsers(rows)
  }

  useEffect(() => {
    void load().catch(() => setMessage('读取用户列表失败'))
  }, [])

  const create = async () => {
    setMessage('')
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, role }),
      })
      setUsername('')
      setPassword('')
      await load()
      setMessage('用户已创建')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '创建失败')
    }
  }

  const updateRole = async (id: string, nextRole: string) => {
    await apiRequest(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: nextRole }),
    })
    await load()
  }

  const disable = async (id: string) => {
    await apiRequest(`/api/users/${id}/disable`, { method: 'PATCH' })
    await load()
  }

  const submitReset = async (id: string) => {
    setMessage('')
    try {
      await apiRequest(`/api/users/${id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({
          newPassword: resetPassword,
          confirmPassword: resetConfirm,
          mustChangePassword: false,
        }),
      })
      setResetId(null)
      setResetPassword('')
      setResetConfirm('')
      await load()
      setMessage('密码已重置')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '重置失败')
    }
  }

  const copyPassword = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setMessage('密码已复制')
    } catch {
      setMessage('复制失败，请手动复制')
    }
  }

  const displayPassword = (value: string | null) => {
    if (!value) return '未记录'
    if (hidePasswords) return '••••••••'
    return value
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">账号管理</h3>
          <p className="mt-1 text-xs text-slate-500">
            创建或停用登录账号，查看密码、注册时间与登录环境。用户自行改密后将不再显示密码。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHidePasswords((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          {hidePasswords ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {hidePasswords ? '显示密码' : '隐藏密码'}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <input
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="text"
          autoComplete="off"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="初始密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void create()}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
        >
          添加用户
        </button>
      </div>

      {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th className="py-2 pr-3">用户名</th>
              <th className="py-2 pr-3">登录密码</th>
              <th className="py-2 pr-3">注册时间</th>
              <th className="py-2 pr-3">注册环境</th>
              <th className="py-2 pr-3">最近登录</th>
              <th className="py-2 pr-3">最近登录环境</th>
              <th className="py-2 pr-3">角色</th>
              <th className="py-2 pr-3">状态</th>
              <th className="py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <React.Fragment key={u.id}>
                <tr className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3 font-medium text-slate-900">{u.username}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          u.managedPassword
                            ? 'font-mono text-slate-800'
                            : 'text-slate-400'
                        }
                      >
                        {displayPassword(u.managedPassword)}
                      </span>
                      {u.managedPassword ? (
                        <button
                          type="button"
                          title="复制密码"
                          onClick={() => void copyPassword(u.managedPassword!)}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-700">
                    {formatDateTime(u.createdAt)}
                  </td>
                  <td className="py-2 pr-3 min-w-[8rem] text-xs text-slate-600">
                    <div>{u.registeredClientLabel}</div>
                    {u.registeredClientInfo !== u.registeredClientLabel &&
                    u.registeredClientInfo !== '—' ? (
                      <div className="mt-0.5 text-[10px] text-slate-400">{u.registeredClientInfo}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-700">
                    {formatDateTime(u.lastLoginAt)}
                  </td>
                  <td className="py-2 pr-3 min-w-[8rem] text-xs text-slate-600">
                    <div>{u.lastLoginClientLabel}</div>
                    {u.lastLoginClientInfo !== u.lastLoginClientLabel &&
                    u.lastLoginClientInfo !== '—' ? (
                      <div className="mt-0.5 text-[10px] text-slate-400">{u.lastLoginClientInfo}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      className="rounded border border-slate-200 px-2 py-1"
                      value={u.role}
                      onChange={(e) => void updateRole(u.id, e.target.value)}
                    >
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="ml-2 text-xs text-slate-400">{ROLE_LABEL[u.role] ?? u.role}</span>
                  </td>
                  <td className="py-2 pr-3">{u.enabled ? '正常' : '已停用'}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-sky-600 hover:underline"
                        onClick={() => {
                          setResetId(resetId === u.id ? null : u.id)
                          setResetPassword('')
                          setResetConfirm('')
                        }}
                      >
                        {resetId === u.id ? '取消重置' : '重置密码'}
                      </button>
                      {u.enabled ? (
                        <button
                          type="button"
                          className="text-rose-600 hover:underline"
                          onClick={() => void disable(u.id)}
                        >
                          停用
                        </button>
                      ) : (
                        <span className="text-slate-400">已停用</span>
                      )}
                    </div>
                  </td>
                </tr>
                {resetId === u.id ? (
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={9} className="py-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="grid gap-1 text-xs text-slate-600">
                          新密码
                          <input
                            type="text"
                            autoComplete="off"
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                          />
                        </label>
                        <label className="grid gap-1 text-xs text-slate-600">
                          确认密码
                          <input
                            type="text"
                            autoComplete="off"
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            value={resetConfirm}
                            onChange={(e) => setResetConfirm(e.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void submitReset(u.id)}
                          className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                        >
                          保存新密码
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
