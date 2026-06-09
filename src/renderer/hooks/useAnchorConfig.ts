import { useCallback, useEffect, useState } from 'react'
import {
  createDefaultAnchorConfig,
  getAnchorConfig,
  resetAnchorConfig,
  saveAnchorConfig,
} from '../lib/configStore'
import { findTimeRuleConflicts } from '../lib/anchorRules'
import type { Anchor, AnchorConfig, TimeRule } from '../types/anchor'

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useAnchorConfig() {
  const [config, setConfig] = useState<AnchorConfig>(createDefaultAnchorConfig())
  const [loaded, setLoaded] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const data = await getAnchorConfig()
      setConfig(data)
      setLoaded(true)
    })()
  }, [])

  const persist = useCallback(async (next: AnchorConfig) => {
    const conflict = findTimeRuleConflicts(next.timeRules)
    if (conflict) {
      setSaveError(conflict)
      return false
    }
    setSaveError(null)
    setConfig(next)
    await saveAnchorConfig(next)
    return true
  }, [])

  const addAnchor = useCallback(
    async (name: string, color: string) => {
      const anchor: Anchor = {
        id: newId('anchor'),
        name: name.trim(),
        color,
        enabled: true,
        createdAt: new Date().toISOString(),
      }
      return persist({ ...config, anchors: [...config.anchors, anchor] })
    },
    [config, persist],
  )

  const updateAnchor = useCallback(
    async (id: string, patch: Partial<Pick<Anchor, 'name' | 'color' | 'enabled'>>) => {
      const next = {
        ...config,
        anchors: config.anchors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }
      return persist(next)
    },
    [config, persist],
  )

  const removeAnchor = useCallback(
    async (id: string) => {
      const next: AnchorConfig = {
        ...config,
        anchors: config.anchors.filter((a) => a.id !== id),
        timeRules: config.timeRules.filter((r) => r.anchorId !== id),
      }
      return persist(next)
    },
    [config, persist],
  )

  const addTimeRule = useCallback(
    async (rule: Omit<TimeRule, 'id'>) => {
      const next: AnchorConfig = {
        ...config,
        timeRules: [...config.timeRules, { ...rule, id: newId('rule') }],
      }
      return persist(next)
    },
    [config, persist],
  )

  const updateTimeRule = useCallback(
    async (id: string, patch: Partial<Omit<TimeRule, 'id'>>) => {
      const next = {
        ...config,
        timeRules: config.timeRules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      }
      return persist(next)
    },
    [config, persist],
  )

  const removeTimeRule = useCallback(
    async (id: string) => {
      const next = {
        ...config,
        timeRules: config.timeRules.filter((r) => r.id !== id),
      }
      return persist(next)
    },
    [config, persist],
  )

  const resetConfig = useCallback(async () => {
    const defaults = await resetAnchorConfig()
    setConfig(defaults)
    setSaveError(null)
    return defaults
  }, [])

  return {
    config,
    loaded,
    saveError,
    setConfig,
    persist,
    addAnchor,
    updateAnchor,
    removeAnchor,
    addTimeRule,
    updateTimeRule,
    removeTimeRule,
    resetConfig,
  }
}
