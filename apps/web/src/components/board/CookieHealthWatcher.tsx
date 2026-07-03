import React, { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBoardSyncMeta } from '../../lib/board-live-query'
import {
  accountCanSyncOrders,
  accountsNotSyncableForModal,
  type CookieHealthPayload,
  type LiveAccountPublic,
} from '../../lib/live-account'
import { CookieExpiredModal } from './CookieExpiredModal'

const STORAGE_KEY = 'cookie-expired-modal-shown'

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

function failureKey(account: LiveAccountPublic): string {
  return `${account.id}:${account.healthStatus ?? account.cookieLastFailedAt ?? account.syncReason ?? 'unknown'}`
}

export const CookieHealthWatcher: React.FC = () => {
  const [modalAccounts, setModalAccounts] = useState<LiveAccountPublic[]>([])
  const [open, setOpen] = useState(false)
  const shownRef = useRef(readShownKeys())

  /** 只读同步元数据，不主动调平台探测 Cookie */
  const poll = useCallback(async () => {
    try {
      const meta = await fetchBoardSyncMeta()
      const payload = (meta as { cookieHealth?: CookieHealthPayload }).cookieHealth ?? null
      const modalSource = accountsNotSyncableForModal(payload)
      const freshModal = modalSource.filter((a) => !shownRef.current.has(failureKey(a)))

      if (freshModal.length > 0) {
        setModalAccounts(freshModal)
        setOpen(true)
        for (const a of freshModal) {
          shownRef.current.add(failureKey(a))
        }
        writeShownKeys(shownRef.current)
      }

      const okAccounts = payload?.accounts.filter((a) => accountCanSyncOrders(a) || a.healthStatus === 'ok') ?? []
      for (const a of okAccounts) {
        for (const key of [...shownRef.current]) {
          if (key.startsWith(`${a.id}:`)) shownRef.current.delete(key)
        }
      }
      writeShownKeys(shownRef.current)
    } catch {
      /* ignore polling errors */
    }
  }, [])

  useEffect(() => {
    void poll()
    const timer = window.setInterval(() => void poll(), 5 * 60_000)
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
