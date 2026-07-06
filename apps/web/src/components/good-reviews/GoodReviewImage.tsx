import React, { useMemo, useState } from 'react'
import { randomUuid } from '../../lib/random-id'

const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#f1f5f9"/><text x="60" y="64" text-anchor="middle" fill="#94a3b8" font-size="12">图片不可用</text></svg>',
  )

const SESSION_KEY = 'good-review-image-session-id'

function readSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function writeSessionId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, id)
  } catch {
    /* sessionStorage 不可用时忽略 */
  }
}

interface Props {
  rawUrl: string
  alt: string
  className?: string
  onClick?: () => void
  debugUrl?: boolean
}

export function buildGoodReviewImageProxyUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl) return PLACEHOLDER
  const params = new URLSearchParams()
  params.set('url', rawUrl)
  const sessionId = readSessionId()
  if (sessionId) params.set('sessionId', sessionId)
  return `/api/good-reviews/image-proxy?${params.toString()}`
}

export const GoodReviewImage: React.FC<Props> = ({
  rawUrl,
  alt,
  className,
  onClick,
  debugUrl = import.meta.env.DEV,
}) => {
  const [failed, setFailed] = useState(false)
  const proxyUrl = useMemo(() => buildGoodReviewImageProxyUrl(rawUrl), [rawUrl])
  const src = !rawUrl || failed ? PLACEHOLDER : proxyUrl
  const title =
    debugUrl && rawUrl ? `代理：${proxyUrl}\n原始：${rawUrl}` : failed ? '图片加载失败' : undefined

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-100 text-center text-[10px] leading-tight text-slate-400 ${className ?? ''}`}
        title={title}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
      >
        图片加载失败
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      title={title}
      className={className}
      loading="lazy"
      onClick={onClick}
      onError={() => setFailed(true)}
    />
  )
}

export function ensureGoodReviewImageSession(): string {
  let id = readSessionId()
  if (!id) {
    id = randomUuid()
    writeSessionId(id)
  }
  return id
}

export function closeGoodReviewImageSessionBeacon(): void {
  let id: string | null = null
  try {
    id = sessionStorage.getItem(SESSION_KEY)
  } catch {
    return
  }
  if (!id) return
  try {
    const blob = new Blob([JSON.stringify({ sessionId: id })], { type: 'application/json' })
    navigator.sendBeacon('/api/good-reviews/image-session/close', blob)
  } catch {
    /* sendBeacon 不可用时忽略 */
  }
}
