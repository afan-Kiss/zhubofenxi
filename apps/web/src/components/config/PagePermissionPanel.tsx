import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import {
  PAGE_PERMISSION_KEYS,
  PAGE_PERMISSION_LABELS,
  type PagePermissionKey,
  type EditableRolePagePermissions,
  type RolePagePermissions,
} from '../../lib/page-permissions'

const ROLE_ROWS: Array<{ role: 'boss' | 'staff'; label: string }> = [
  { role: 'boss', label: '老板' },
  { role: 'staff', label: '员工' },
]

function pickEditableMatrix(matrix: RolePagePermissions): EditableRolePagePermissions {
  return {
    boss: buildFullRow('boss', matrix),
    staff: buildFullRow('staff', matrix),
  }
}

function buildFullRow(
  role: 'boss' | 'staff',
  matrix: RolePagePermissions | EditableRolePagePermissions,
): Record<PagePermissionKey, boolean> {
  const current = matrix[role] ?? {}
  return Object.fromEntries(
    PAGE_PERMISSION_KEYS.map((key) => [key, Boolean(current[key])]),
  ) as Record<PagePermissionKey, boolean>
}

export const PagePermissionPanel: React.FC = () => {
  const [matrix, setMatrix] = useState<EditableRolePagePermissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest<RolePagePermissions>('/api/auth/page-permissions')
      setMatrix(pickEditableMatrix(data))
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取权限配置失败')
      setMatrix(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = (role: 'boss' | 'staff', key: PagePermissionKey) => {
    setMatrix((prev) => {
      if (!prev) return prev
      const row = buildFullRow(role, prev)
      row[key] = !row[key]
      return { ...prev, [role]: row }
    })
    setMessage('')
    setError('')
  }

  const save = async () => {
    if (!matrix) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const saved = await apiRequest<RolePagePermissions>('/api/auth/page-permissions', {
        method: 'PUT',
        body: JSON.stringify({
          matrix: {
            boss: buildFullRow('boss', matrix),
            staff: buildFullRow('staff', matrix),
          },
        }),
      })
      setMatrix(pickEditableMatrix(saved))
      setMessage('权限已保存。员工/老板账号需重新登录后菜单才会更新。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-slate-500">正在加载权限配置…</p>
  if (!matrix) return <p className="text-sm text-red-600">{error || '无法加载权限配置'}</p>

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-base font-semibold text-slate-900">页面显示权限</h3>
      <p className="mt-1 text-xs text-slate-500">
        控制不同角色能看到哪些主菜单。管理员账号始终可见全部页面。
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th className="py-2 pr-4">页面</th>
              {ROLE_ROWS.map((r) => (
                <th key={r.role} className="py-2 px-2 text-center">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAGE_PERMISSION_KEYS.map((key) => (
              <tr key={key} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-800">{PAGE_PERMISSION_LABELS[key]}</td>
                {ROLE_ROWS.map((r) => (
                  <td key={r.role} className="py-2 px-2 text-center">
                    <input
                      type="checkbox"
                      checked={Boolean(matrix[r.role]?.[key])}
                      onChange={() => toggle(r.role, key)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存权限'}
        </button>
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void load()}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          重新加载
        </button>
        {message ? <span className="text-sm text-emerald-700">{message}</span> : null}
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>
    </div>
  )
}
