import type { AnchorConfig } from '../types/anchor'

const FALLBACK_KEY = 'live-order-dashboard-anchor-config'

export function createDefaultAnchorConfig(): AnchorConfig {
  const now = new Date().toISOString()
  return {
    version: 1,
    anchors: [
      {
        id: 'anchor-zijie',
        name: '子杰',
        color: '#FF2442',
        enabled: true,
        createdAt: now,
      },
      {
        id: 'anchor-feiyun',
        name: '飞云',
        color: '#FF8A3D',
        enabled: true,
        createdAt: now,
      },
    ],
    timeRules: [
      {
        id: 'rule-morning',
        name: '上午场',
        startTime: '00:00',
        endTime: '14:59',
        anchorId: 'anchor-zijie',
        enabled: true,
      },
      {
        id: 'rule-evening',
        name: '晚上场',
        startTime: '15:00',
        endTime: '23:59',
        anchorId: 'anchor-feiyun',
        enabled: true,
      },
    ],
  }
}

export async function getAnchorConfig(): Promise<AnchorConfig> {
  if (window.dashboardAPI?.getAnchorConfig) {
    return window.dashboardAPI.getAnchorConfig()
  }
  try {
    const raw = localStorage.getItem(FALLBACK_KEY)
    if (raw) return JSON.parse(raw) as AnchorConfig
  } catch {
    /* ignore */
  }
  return createDefaultAnchorConfig()
}

export async function saveAnchorConfig(config: AnchorConfig): Promise<void> {
  if (window.dashboardAPI?.saveAnchorConfig) {
    await window.dashboardAPI.saveAnchorConfig(config)
    return
  }
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(config))
}

export async function resetAnchorConfig(): Promise<AnchorConfig> {
  if (window.dashboardAPI?.resetAnchorConfig) {
    return window.dashboardAPI.resetAnchorConfig()
  }
  const defaults = createDefaultAnchorConfig()
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(defaults))
  return defaults
}
