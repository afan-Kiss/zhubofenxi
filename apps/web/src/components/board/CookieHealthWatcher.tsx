import React, { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBoardSyncMeta } from '../../lib/board-live-query'
import {
  invalidAccountsForModal,
  type CookieHealthPayload,
} from '../../lib/live-account'
import { CookieExpiredModal } from './CookieExpiredModal'

const STORAGE_KEY = 'cookie-expired-modal-shown'

function failureKeys(payload: CookieHealthPayload): string[] {
  return invalidAccountsForModal(payload).map(
    (a) => `${a.id}:${a.cookieLastFailedAt ?? 'unknown'}`,
  )
}

function readShownKeys(): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as string[]
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function writeShownKeys(keys: Set<string>): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]))
}

export const CookieHealthWatcher: React.FC = () => {
  const [modalAccounts, setModalAccounts] = useState<CookieHealthPayload['accounts']>([])
  const [open, setOpen] = useState(false)
  const shownRef = useRef(readShownKeys())

  const poll = useCallback(async () => {
    try {
      const meta = await fetchBoardSyncMeta()
      const payload = (meta as { cookieHealth?: CookieHealthPayload }).cookieHealth ?? null
      if (!payload) return

      const invalid = invalidAccountsForModal(payload)
      const fresh = invalid.filter((a) => {
        const key = `${a.id}:${a.cookieLastFailedAt ?? 'unknown'}`
        return !shownRef.current.has(key)
      })

      if (fresh.length > 0) {
        setModalAccounts(fresh)
        setOpen(true)
        for (const a of fresh) {
          shownRef.current.add(`${a.id}:${a.cookieLastFailedAt ?? 'unknown'}`)
        }
        writeShownKeys(shownRef.current)
      }

      for (const a of payload.accounts) {
        if (a.cookieStatus === 'valid') {
          for (const key of [...shownRef.current]) {
            if (key.startsWith(`${a.id}:`)) shownRef.current.delete(key)
          }
        }
      }
      writeShownKeys(shownRef.current)
    } catch {
      /* ignore polling errors */
    }
  }, [])

  useEffect(() => {
    void poll()
    const timer = window.setInterval(() => void poll(), 60_000)
    return () => window.clearInterval(timer)
  }, [poll])

  return (
    <CookieExpiredModal
      open={open}
      accounts={modalAccounts}
      onDismiss={() => setOpen(false)}
    />
  )
}
