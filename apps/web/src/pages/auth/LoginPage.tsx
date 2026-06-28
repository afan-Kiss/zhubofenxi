import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiRequest } from '../../lib/api'
import { useAuth } from '../../providers/AuthProvider'

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const { refresh, allowRegister } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
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
        <h1 className="text-xl font-semibold text-slate-900">登录经营看板</h1>
        <p className="mt-1 text-sm text-slate-500">请输入账号和密码</p>
        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <label className="mt-4 block text-sm text-slate-700">
          账号
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          密码
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-rose-600 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? '登录中…' : '登录'}
        </button>
        {allowRegister ? (
          <p className="mt-4 text-center text-sm text-slate-500">
            还没有账号？{' '}
            <Link to="/register" className="text-rose-600 hover:underline">
              去注册
            </Link>
          </p>
        ) : null}
      </form>
    </div>
  )
}
