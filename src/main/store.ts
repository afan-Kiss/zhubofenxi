import Store from 'electron-store'

export interface AnchorRecord {
  id: string
  name: string
  color: string
  enabled: boolean
  createdAt: string
}

export interface TimeRuleRecord {
  id: string
  name: string
  startTime: string
  endTime: string
  anchorId: string
  enabled: boolean
}

export interface AnchorConfigRecord {
  version: number
  anchors: AnchorRecord[]
  timeRules: TimeRuleRecord[]
}

function nowIso(): string {
  return new Date().toISOString()
}

export function createDefaultAnchorConfig(): AnchorConfigRecord {
  return {
    version: 1,
    anchors: [
      {
        id: 'anchor-zijie',
        name: '子杰',
        color: '#FF2442',
        enabled: true,
        createdAt: nowIso(),
      },
      {
        id: 'anchor-feiyun',
        name: '飞云',
        color: '#FF8A3D',
        enabled: true,
        createdAt: nowIso(),
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

const anchorStore = new Store<{ anchorConfig: AnchorConfigRecord }>({
  name: 'live-order-dashboard',
  defaults: {
    anchorConfig: createDefaultAnchorConfig(),
  },
})

export function getAnchorConfigFromStore(): AnchorConfigRecord {
  return anchorStore.get('anchorConfig')
}

export function saveAnchorConfigToStore(config: AnchorConfigRecord): void {
  anchorStore.set('anchorConfig', config)
}

export function resetAnchorConfigInStore(): AnchorConfigRecord {
  const defaults = createDefaultAnchorConfig()
  anchorStore.set('anchorConfig', defaults)
  return defaults
}
