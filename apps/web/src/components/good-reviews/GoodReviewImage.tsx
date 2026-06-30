import React, { useMemo, useState } from 'react'

const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#f1f5f9"/><text x="60" y="64" text-anchor="middle" fill="#94a3b8" font-size="12">图片不可用</text></svg>',
  )

interface Props {
  rawUrl: string
  alt: string
  className?: string
  onClick?: () => void
}

export const GoodReviewImage: React.FC<Props> = ({ rawUrl, alt, className, onClick }) => {
  const [failed, setFailed] = useState(false)
  const src = useMemo(() => {
    if (!rawUrl || failed) return PLACEHOLDER
    const params = new URLSearchParams()
    params.set('url', rawUrl)
    const sessionId = sessionStorage.getItem('good-review-image-session-id')
    if (sessionId) params.set('sessionId', sessionId)
    return `/api/good-reviews/image-proxy?${params.toString()}`
  }, [rawUrl, failed])

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onClick={onClick}
      onError={() => setFailed(true)}
    />
  )
}

export function ensureGoodReviewImageSession(): string {
  const key = 'good-review-image-session-id'
  let id = sessionStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(key, id)
  }
  return id
}

export function closeGoodReviewImageSessionBeacon(): void {
  const id = sessionStorage.getItem('good-review-image-session-id')
  if (!id) return
  const blob = new Blob([JSON.stringify({ sessionId: id })], { type: 'application/json' })
  navigator.sendBeacon('/api/good-reviews/image-session/close', blob)
}
