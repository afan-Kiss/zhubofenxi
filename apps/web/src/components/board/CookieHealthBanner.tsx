import React from 'react'
import { Link } from 'react-router-dom'
import { buildCookieBannerMessage, type CookieHealthPayload } from '../../lib/live-account'

interface Props {
  cookieHealth: CookieHealthPayload | null
  className?: string
}

export const CookieHealthBanner: React.FC<Props> = ({ cookieHealth, className = '' }) => {
  const message = buildCookieBannerMessage(cookieHealth)
  if (!message) return null

  const cannotSync = cookieHealth?.summary.cannotSyncCount ?? 0
  const hasError = cannotSync > 0

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        hasError
          ? 'border-rose-200 bg-rose-50 text-rose-900'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      } ${className}`}
      role="alert"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        <Link
          to="/settings#live-account-cookie"
          className="shrink-0 font-medium underline underline-offset-2"
        >
          去系统设置
        </Link>
      </div>
    </div>
  )
}
