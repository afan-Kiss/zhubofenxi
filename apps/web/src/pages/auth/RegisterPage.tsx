import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiRequest } from '../../lib/api'

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, confirmPassword }),
      })
      navigate('/login', { replace: true, state: { registered: username } })
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-rose-50 to-slate-100 px-4">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="w-full max-w-sm rounded-2xl border border-white/80 bg-white p-6 shadow-lg"
      >
        <h1 className="text-xl font-semibold text-slate-900">注册账号</h1>
        <p className="mt-1 text-sm text-slate-500">注册后默认以员工身份登录，页面权限由管理员配置</p>
        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <label className="mt-4 block text-sm text-slate-700">
          用户名
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          密码（至少 8 位）
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          确认密码
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-rose-600 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? '提交中…' : '注册'}
        </button>
        <p className="mt-4 text-center text-sm text-slate-500">
          已有账号？{' '}
          <Link to="/login" className="text-rose-600 hover:underline">
            去登录
          </Link>
        </p>
      </form>
    </div>
  )
}
