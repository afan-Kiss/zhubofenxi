import React, { useEffect, useMemo, useRef, useState } from 'react'
import { randomUuid } from '../../lib/random-id'
import { buildCsChatImageProxyUrl } from '../../lib/refund-analysis'

const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#f1f5f9"/><text x="60" y="64" text-anchor="middle" fill="#94a3b8" font-size="12">图片不可用</text></svg>',
  )

const SESSION_KEY = 'cs-chat-image-session-id'

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
    /* ignore */
  }
}

export function ensureCsChatImageSession(): string {
  const existing = readSessionId()
  if (existing) return existing
  const id = randomUuid()
  writeSessionId(id)
  return id
}

export function closeCsChatImageSessionBeacon(): void {
  const sessionId = readSessionId()
  if (!sessionId) return
  try {
    const blob = new Blob([JSON.stringify({ sessionId })], { type: 'application/json' })
    navigator.sendBeacon('/api/refund-analysis/image-session/close', blob)
  } catch {
    /* ignore */
  }
}

interface Props {
  rawUrl: string
  alt: string
  className?: string
  onClick?: () => void
}

export const CsChatImage: React.FC<Props> = ({ rawUrl, alt, className, onClick }) => {
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(false)
  const holderRef = useRef<HTMLDivElement | null>(null)
  const proxyUrl = useMemo(() => {
    if (!visible || !rawUrl) return null
    return buildCsChatImageProxyUrl(rawUrl, readSessionId())
  }, [rawUrl, visible])

  useEffect(() => {
    setFailed(false)
    setVisible(false)
  }, [rawUrl])

  useEffect(() => {
    const el = holderRef.current
    if (!el || !rawUrl) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '180px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [rawUrl])

  return (
    <div ref={holderRef} className={className}>
      <button
        type="button"
        className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
        onClick={onClick}
      >
        <img
          src={failed || !proxyUrl ? PLACEHOLDER : proxyUrl}
          alt={alt}
          className="max-h-56 max-w-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </button>
    </div>
  )
}
