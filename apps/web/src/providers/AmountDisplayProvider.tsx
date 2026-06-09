import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { apiRequest } from '../lib/api'
import {
  formatCentDisplay,
  formatCountDisplay,
  formatMoneyDisplay,
  formatRateDisplay,
  type AmountDisplayMode,
} from '../lib/format-money'

interface AmountDisplayContextValue {
  mode: AmountDisplayMode
  setMode: (mode: AmountDisplayMode) => void
  formatMoney: (yuan: number) => string
  formatCent: (cent: number) => string
  formatCount: (value: number) => string
  formatRate: (rate: number | null | undefined) => string
  reload: () => Promise<void>
}

const AmountDisplayContext = createContext<AmountDisplayContextValue | null>(null)

export const AmountDisplayProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mode, setModeState] = useState<AmountDisplayMode>('full')

  const reload = useCallback(async () => {
    try {
      await apiRequest<{ amountDisplayMode: AmountDisplayMode }>(
        '/api/settings/display-settings',
      )
      setModeState('full')
    } catch {
      /* keep default */
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const onUpdated = () => void reload()
    window.addEventListener('amount-display-updated', onUpdated)
    return () => window.removeEventListener('amount-display-updated', onUpdated)
  }, [reload])

  const setMode = (next: AmountDisplayMode) => setModeState(next === 'wan' ? 'full' : next)

  const value: AmountDisplayContextValue = {
    mode: 'full',
    setMode,
    formatMoney: (yuan) => formatMoneyDisplay(yuan),
    formatCent: (cent) => formatCentDisplay(cent),
    formatCount: (n) => formatCountDisplay(n),
    formatRate: (r) => formatRateDisplay(r),
    reload,
  }

  return (
    <AmountDisplayContext.Provider value={value}>{children}</AmountDisplayContext.Provider>
  )
}

export function useAmountDisplay(): AmountDisplayContextValue {
  const ctx = useContext(AmountDisplayContext)
  if (!ctx) {
    return {
      mode: 'full',
      setMode: () => undefined,
      formatMoney: (yuan) => formatMoneyDisplay(yuan),
      formatCent: (cent) => formatCentDisplay(cent),
      formatCount: (n) => formatCountDisplay(n),
      formatRate: (r) => formatRateDisplay(r),
      reload: async () => undefined,
    }
  }
  return ctx
}
