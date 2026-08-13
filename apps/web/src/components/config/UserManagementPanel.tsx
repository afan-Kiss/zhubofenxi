import React, { useEffect, useMemo, useState } from 'react'
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { apiRequest } from '../../lib/api'
import { formatDateTimeShanghai } from '../../lib/business-timezone'
import { useAuth } from '../../providers/AuthProvider'

interface UserRow {
  id: string
  username: string
  role: string
  enabled: boolean
  remark: string | null
  managedPassword: string | null
  createdAt: string
  lastAccessAt?: string | null
  lastAccessClientInfo?: string
  lastAccessClientLabel?: string
  /** @deprecated 兼容旧字段，等同 lastAccessAt */
  lastLoginAt?: string | null
  registeredClientInfo: string
  registeredClientLabel: string
  lastLoginClientInfo?: string
  lastLoginClientLabel?: string
  isPrimarySuperAdmin?: boolean
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
  local_viewer: '本地看板',
}

const PRIMARY_SUPER_ADMIN_USERNAME = 'fanfan'

function formatDateTime(iso: string | null): string {
  return formatDateTimeShanghai(iso)
}

function resolveLastAccess(row: UserRow): string | null {
  return row.lastAccessAt ?? row.lastLoginAt ?? null
}

function resolveLastAccessClientLabel(row: UserRow): string {
  return row.lastAccessClientLabel ?? row.lastLoginClientLabel ?? '—'
}

function isPrimarySuperAdmin(row: UserRow): boolean {
  return row.isPrimarySuperAdmin === true || row.username === PRIMARY_SUPER_ADMIN_USERNAME
}

function roleBadgeClass(role: string, primary: boolean): string {
  if (primary) return 'bg-amber-50 text-amber-800 ring-amber-200/80'
  if (role === 'super_admin') return 'bg-sky-50 text-sky-800 ring-sky-200/80'
  if (role === 'boss') return 'bg-violet-50 text-violet-800 ring-violet-200/80'
  return 'bg-slate-100 text-slate-700 ring-slate-200/80'
}

export const UserManagementPanel: React.FC = () => {
  const { user: currentUser } = useAuth()
  const isTopAdmin = currentUser?.username === PRIMARY_SUPER_ADMIN_USERNAME
  const [users, setUsers] = useState<UserRow[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remark, setRemark] = useState('')
  const [role, setRole] = useState('staff')
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'ok' | 'err'>('ok')
  const [hidePasswords, setHidePasswords] = useState(false)
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>({})
  const [savingRemarkId, setSavingRemarkId] = useState<string | null>(null)

  const createRoleOptions = isTopAdmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((o) => o.value !== 'super_admin')

  useEffect(() => {
    if (!isTopAdmin && role === 'super_admin') {
      setRole('staff')
    }
  }, [isTopAdmin, role])

  const load = async () => {
    const rows = await apiRequest<UserRow[]>('/api/users')
    setUsers(rows)
    setRemarkDrafts((prev) => {
      const next: Record<string, string> = {}
      for (const row of rows) {
        next[row.id] = prev[row.id] ?? row.remark ?? ''
      }
      return next
    })
  }

  useEffect(() => {
    void load().catch(() => {
      setMessageTone('err')
      setMessage('读取用户列表失败')
    })
    const timer = window.setInterval(() => {
      void load().catch(() => undefined)
    }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void load().catch(() => undefined)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const stats = useMemo(() => {
    const total = users.length
    const disabled = users.filter((u) => !u.enabled).length
    const admins = users.filter((u) => u.role === 'super_admin').length
    return { total, disabled, admins, active: total - disabled }
  }, [users])

  const canManageRow = (row: UserRow): boolean => {
    if (isPrimarySuperAdmin(row)) return false
    if (row.role === 'super_admin') return isTopAdmin
    return true
  }

  const canResetPassword = (row: UserRow): boolean => {
    if (currentUser?.id === row.id) return true
    if (isPrimarySuperAdmin(row)) return isTopAdmin
    return canManageRow(row)
  }

  const canEditRemark = (row: UserRow): boolean => {
    if (isPrimarySuperAdmin(row)) return isTopAdmin
    if (row.role === 'super_admin') return isTopAdmin
    return true
  }

  const flash = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setMessageTone(tone)
    setMessage(text)
  }

  const create = async () => {
    flash('')
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          role,
          remark: remark.trim() || null,
        }),
      })
      setUsername('')
      setPassword('')
      setRemark('')
      await load()
      flash('用户已创建')
    } catch (err) {
      flash(err instanceof Error ? err.message : '创建失败', 'err')
    }
  }

  const updateRole = async (id: string, nextRole: string) => {
    flash('')
    try {
      await apiRequest(`/api/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      })
      await load()
      flash('角色已更新')
    } catch (err) {
      flash(err instanceof Error ? err.message : '更新角色失败', 'err')
    }
  }

  const saveRemark = async (row: UserRow) => {
    if (!canEditRemark(row)) return
    const next = (remarkDrafts[row.id] ?? '').trim()
    const prev = (row.remark ?? '').trim()
    if (next === prev) return
    setSavingRemarkId(row.id)
    flash('')
    try {
      await apiRequest(`/api/users/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ remark: next || null }),
      })
      await load()
      flash('备注已保存')
    } catch (err) {
      flash(err instanceof Error ? err.message : '保存备注失败', 'err')
    } finally {
      setSavingRemarkId(null)
    }
  }

  const disable = async (id: string) => {
    flash('')
    try {
      await apiRequest(`/api/users/${id}/disable`, { method: 'PATCH' })
      await load()
      flash('账号已停用，可随时恢复')
    } catch (err) {
      flash(err instanceof Error ? err.message : '停用失败', 'err')
    }
  }

  const restore = async (id: string) => {
    flash('')
    try {
      await apiRequest(`/api/users/${id}/enable`, { method: 'PATCH' })
      await load()
      flash('账号已恢复，可正常登录')
    } catch (err) {
      flash(err instanceof Error ? err.message : '恢复失败', 'err')
    }
  }

  const remove = async (row: UserRow) => {
    const ok = window.confirm(
      `确认删除账号「${row.username}」？删除后不可恢复，该账号将立即无法登录。`,
    )
    if (!ok) return
    flash('')
    try {
      await apiRequest(`/api/users/${row.id}`, { method: 'DELETE' })
      await load()
      flash(`已删除账号 ${row.username}`)
    } catch (err) {
      flash(err instanceof Error ? err.message : '删除失败', 'err')
    }
  }

  const submitReset = async (id: string) => {
    flash('')
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
      flash('密码已重置')
    } catch (err) {
      flash(err instanceof Error ? err.message : '重置失败', 'err')
    }
  }

  const copyPassword = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      flash('密码已复制')
    } catch {
      flash('复制失败，请手动复制', 'err')
    }
  }

  const displayPassword = (value: string | null) => {
    if (!value) return '未记录'
    if (hidePasswords) return '••••••••'
    return value
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/80 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
      <div className="border-b border-slate-100 bg-white/90 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white">
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">账号管理</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {isTopAdmin
                    ? '最高权限 fanfan：可停用、恢复、删除含管理员在内的全部账号'
                    : '可管理员工/老板账号；管理员账号仅 fanfan 可操作'}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHidePasswords((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            {hidePasswords ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {hidePasswords ? '显示密码' : '隐藏密码'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: '全部账号', value: stats.total },
            { label: '正常', value: stats.active },
            { label: '已停用', value: stats.disabled },
            { label: '管理员', value: stats.admins },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2"
            >
              <div className="text-[11px] text-slate-500">{item.label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <UserPlus className="h-3.5 w-3.5" />
          添加账号
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-rose-200/60 transition focus:border-rose-300 focus:ring-2"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="text"
            autoComplete="off"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-rose-200/60 transition focus:border-rose-300 focus:ring-2"
            placeholder="初始密码（至少 8 位）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-rose-200/60 transition focus:border-rose-300 focus:ring-2"
            placeholder="备注（可选，如：运营小王）"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          <select
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-rose-200/60 transition focus:border-rose-300 focus:ring-2"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {createRoleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void create()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            添加用户
          </button>
        </div>
        {message ? (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-sm ${
              messageTone === 'err'
                ? 'bg-rose-50 text-rose-700'
                : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        {users.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
            暂无账号
          </div>
        ) : (
          users.map((u) => {
            const manageable = canManageRow(u)
            const primary = isPrimarySuperAdmin(u)
            const remarkDirty =
              (remarkDrafts[u.id] ?? '').trim() !== (u.remark ?? '').trim()
            return (
              <article
                key={u.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
                  u.enabled
                    ? 'border-slate-200/90'
                    : 'border-rose-200/70 bg-rose-50/30'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-semibold text-slate-900">
                        {u.username}
                      </h4>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${roleBadgeClass(
                          u.role,
                          primary,
                        )}`}
                      >
                        {primary ? '最高权限' : ROLE_LABEL[u.role] ?? u.role}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                          u.enabled
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/80'
                            : 'bg-rose-50 text-rose-700 ring-rose-200/80'
                        }`}
                      >
                        {u.enabled ? '正常' : '已停用'}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-[11px] text-slate-500 sm:grid-cols-2">
                      <div>
                        注册 {formatDateTime(u.createdAt)}
                        <span className="mx-1 text-slate-300">·</span>
                        {u.registeredClientLabel}
                      </div>
                      <div>
                        最近访问 {formatDateTime(resolveLastAccess(u))}
                        <span className="mx-1 text-slate-300">·</span>
                        {resolveLastAccessClientLabel(u)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {canResetPassword(u) ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
                        onClick={() => {
                          setResetId(resetId === u.id ? null : u.id)
                          setResetPassword('')
                          setResetConfirm('')
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {resetId === u.id ? '取消' : '重置密码'}
                      </button>
                    ) : null}

                    {manageable ? (
                      <>
                        {u.enabled ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
                            onClick={() => void disable(u.id)}
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                            停用
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100"
                            onClick={() => void restore(u.id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            恢复
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
                          onClick={() => void remove(u)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </button>
                      </>
                    ) : primary ? (
                      <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-400">
                        受保护
                      </span>
                    ) : (
                      <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-400">
                        仅 fanfan 可管理
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 lg:grid-cols-[1fr_1fr_1.2fr]">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">登录密码</div>
                    <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
                      <span
                        className={
                          u.managedPassword
                            ? 'font-mono text-sm text-slate-800'
                            : 'text-sm text-slate-400'
                        }
                      >
                        {displayPassword(u.managedPassword)}
                      </span>
                      {u.managedPassword ? (
                        <button
                          type="button"
                          title="复制密码"
                          onClick={() => void copyPassword(u.managedPassword!)}
                          className="ml-auto text-slate-400 transition hover:text-slate-700"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">角色</div>
                    {manageable ? (
                      <select
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-200/60"
                        value={u.role}
                        onChange={(e) => void updateRole(u.id, e.target.value)}
                      >
                        {(isTopAdmin
                          ? ROLE_OPTIONS
                          : ROLE_OPTIONS.filter((o) => o.value !== 'super_admin')
                        ).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
                        {primary ? '最高权限' : ROLE_LABEL[u.role] ?? u.role}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] font-medium text-slate-500">备注</div>
                    {canEditRemark(u) ? (
                      <div className="flex gap-2">
                        <input
                          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-200/60"
                          placeholder="例如：财务查看 / 早班运营"
                          value={remarkDrafts[u.id] ?? ''}
                          onChange={(e) =>
                            setRemarkDrafts((prev) => ({ ...prev, [u.id]: e.target.value }))
                          }
                          onBlur={() => void saveRemark(u)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur()
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={!remarkDirty || savingRemarkId === u.id}
                          onClick={() => void saveRemark(u)}
                          className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {savingRemarkId === u.id ? '…' : '保存'}
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-500">
                        {u.remark?.trim() || '—'}
                      </div>
                    )}
                  </div>
                </div>

                {resetId === u.id ? (
                  <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3">
                    <div className="mb-2 text-xs font-medium text-sky-800">重置登录密码</div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="grid gap-1 text-xs text-slate-600">
                        新密码
                        <input
                          type="text"
                          autoComplete="off"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-slate-600">
                        确认密码
                        <input
                          type="text"
                          autoComplete="off"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
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
                  </div>
                ) : null}
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
