import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/api'
import type { AuthMePayload, PagePermissionKey } from '../lib/page-permissions'

interface AuthContextValue {
  loading: boolean
  user: AuthMePayload['user'] | null
  mode: 'session' | 'local'
  permissions: Record<PagePermissionKey, boolean>
  allowRegister: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  canAccess: (key: PagePermissionKey) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<AuthMePayload['user'] | null>(null)
  const [mode, setMode] = useState<'session' | 'local'>('local')
  const [permissions, setPermissions] = useState<Record<PagePermissionKey, boolean>>({
    overview: true,
    anchors: true,
    buyers: true,
    operations_report: true,
    good_reviews: true,
    boss_dashboard: true,
    lucky_gifts: true,
    settings: true,
  })
  const [allowRegister, setAllowRegister] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const modeRes = await apiRequest<{ mode: 'session' | 'local'; allowRegister: boolean }>(
        '/api/auth/mode',
      )
      setMode(modeRes.mode)
      setAllowRegister(modeRes.allowRegister)
      const me = await apiRequest<AuthMePayload>('/api/auth/me')
      setUser(me.user)
      setPermissions(me.permissions)
    } catch {
      if (mode === 'session') {
        setUser(null)
      }
    }
  }, [mode])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const modeRes = await apiRequest<{ mode: 'session' | 'local'; allowRegister: boolean }>(
          '/api/auth/mode',
        )
        setMode(modeRes.mode)
        setAllowRegister(modeRes.allowRegister)
        const me = await apiRequest<AuthMePayload>('/api/auth/me')
        setUser(me.user)
        setPermissions(me.permissions)
      } catch {
        setUser(null)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    setUser(null)
  }, [])

  const canAccess = useCallback(
    (key: PagePermissionKey) => permissions[key] === true,
    [permissions],
  )

  const value = useMemo(
    () => ({
      loading,
      user,
      mode,
      permissions,
      allowRegister,
      refresh,
      logout,
      canAccess,
    }),
    [loading, user, mode, permissions, allowRegister, refresh, logout, canAccess],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
