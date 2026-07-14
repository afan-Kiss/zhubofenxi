import type { AnchorConfig } from '../types/analysis'

export function createDefaultAnchorConfig(): AnchorConfig {
  return {
    anchors: [
      { id: 'anchor-zijie', name: '子杰', color: '#FF2442', enabled: true, attributionMode: 'schedule' },
      { id: 'anchor-feiyun', name: '飞云', color: '#FF8A3D', enabled: true, attributionMode: 'schedule' },
    ],
    timeRules: [
      {
        id: 'rule-morning',
        name: '上午场',
        startTime: '00:00',
        endTime: '17:59',
        anchorId: 'anchor-zijie',
        enabled: true,
      },
      {
        id: 'rule-evening',
        name: '晚上场',
        startTime: '18:00',
        endTime: '23:59',
        anchorId: 'anchor-feiyun',
        enabled: true,
      },
    ],
  }
}
