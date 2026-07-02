import React, { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { fetchBoardSyncMeta } from '../../lib/board-live-query'
import {
  accountCanSyncOrders,
  accountsNotSyncableForModal,
  isCookieHealthBlocking,
  type CookieHealthPayload,
  type LiveAccountPublic,
  type ShopCookieHealthResult,
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

function shopHealthToAccount(shop: ShopCookieHealthResult): LiveAccountPublic {
  return {
    id: shop.accountId ?? shop.shopCode,
    name: shop.shopName,
    enabled: true,
    hasCookie: shop.hasCookie,
    cookiePreview: shop.hasCookie ? '已保存' : null,
    cookieUpdatedAt: shop.updatedAt,
    cookieStatus: shop.status === 'ok' ? 'valid' : shop.status === 'unknown' ? 'unknown' : 'invalid',
    cookieLastCheckedAt: shop.checkedAt,
    cookieLastSuccessAt: shop.ok ? shop.checkedAt : null,
    cookieLastFailedAt: shop.ok ? null : shop.checkedAt,
    cookieLastErrorCode: null,
    cookieLastErrorMessage: shop.ok ? null : shop.reason,
    cookieLastFailedApi: shop.failedEndpoint,
    affectedBusinessSync: !shop.ok,
    lastSyncSuccessAt: null,
    canSyncOrders: shop.ok,
    officialShopKey: shop.shopCode,
    syncReason: shop.reason,
    healthStatus: shop.status,
    statusLevel: shop.ok ? 'ok' : shop.status === 'unknown' ? 'warning' : 'error',
    cookieDisplayStatus: shop.status,
  }
}

export const CookieHealthWatcher: React.FC = () => {
  const [modalAccounts, setModalAccounts] = useState<LiveAccountPublic[]>([])
  const [open, setOpen] = useState(false)
  const shownRef = useRef(readShownKeys())
  const freshProbeDoneRef = useRef(false)

  const poll = useCallback(async (options?: { fresh?: boolean }) => {
    try {
      const fresh = options?.fresh === true
      const [meta, healthPayload] = await Promise.all([
        fetchBoardSyncMeta(),
        fresh
          ? apiRequest<{ shops: ShopCookieHealthResult[] }>('/api/shop-cookies/health?fresh=1')
          : Promise.resolve(null),
      ])

      const payload = (meta as { cookieHealth?: CookieHealthPayload }).cookieHealth ?? null
      const modalSource: LiveAccountPublic[] = fresh && healthPayload?.shops
        ? healthPayload.shops
            .map(shopHealthToAccount)
            .filter((a) => isCookieHealthBlocking(a.healthStatus))
        : accountsNotSyncableForModal(payload)

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
    void poll({ fresh: true }).finally(() => {
      freshProbeDoneRef.current = true
    })
    const timer = window.setInterval(() => void poll({ fresh: false }), 60_000)
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
