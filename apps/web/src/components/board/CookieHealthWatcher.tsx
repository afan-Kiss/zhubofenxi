import React, { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBoardSyncMeta } from '../../lib/board-live-query'
import {
  accountCanSyncOrders,
  accountsNotSyncableForModal,
  type CookieHealthPayload,
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

function failureKey(account: CookieHealthPayload['accounts'][number]): string {
  return `${account.id}:${account.cookieLastFailedAt ?? account.syncReason ?? 'unknown'}`
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

      const notSyncable = accountsNotSyncableForModal(payload)
      const fresh = notSyncable.filter((a) => !shownRef.current.has(failureKey(a)))

      if (fresh.length > 0) {
        setModalAccounts(fresh)
        setOpen(true)
        for (const a of fresh) {
          shownRef.current.add(failureKey(a))
        }
        writeShownKeys(shownRef.current)
      }

      for (const a of payload.accounts) {
        if (accountCanSyncOrders(a)) {
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
