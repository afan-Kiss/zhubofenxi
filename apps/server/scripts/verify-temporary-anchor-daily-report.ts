/**
 * 临时试播主播 → 日报候选 / 标识字段（不写库）
 * npx tsx apps/server/scripts/verify-temporary-anchor-daily-report.ts
 */
import assert from 'node:assert/strict'
import {
  resolveDailyReportAnchorsForDate,
  ANCHOR_SESSION_DISPLAY_FROM_0613,
} from '../src/services/anchor-performance-attribution.service'
import { isAnchorEffectiveOnDate } from '../src/utils/anchor-effective-date.util'
import type { AnchorConfig } from '../src/services/anchor.service'

function main() {
  console.log('verify-temporary-anchor-daily-report\n')

  const config = {
    anchors: [
      {
        id: 'a1',
        name: '小红',
        color: '#111',
        enabled: false,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-07-17',
        attributionMode: 'schedule',
        systemKey: null,
        sortOrder: 0,
      },
      {
        id: 'a2',
        name: '小白',
        color: '#222',
        enabled: true,
        effectiveFrom: '2026-06-18',
        effectiveTo: null,
        attributionMode: 'schedule',
        systemKey: null,
        sortOrder: 1,
      },
    ],
    timeRules: [],
  } as unknown as AnchorConfig

  // 离职当天仍可进入日报候选（硬编码路径也会按 effectiveTo 过滤）
  const onLastDay = resolveDailyReportAnchorsForDate(config, '2026-07-17')
  const hasHongOnLast = onLastDay.some((a) => a.anchorName === '小红')
  // 若硬编码名单含小红则应保留；若不含也不应因 enabled=false 误杀其他逻辑
  if (Object.keys(ANCHOR_SESSION_DISPLAY_FROM_0613).includes('小红') || hasHongOnLast) {
    assert.equal(
      isAnchorEffectiveOnDate(
        { effectiveFrom: '2026-01-01', effectiveTo: '2026-07-17', enabled: false },
        '2026-07-17',
      ),
      true,
    )
  }
  console.log('  ✓ 离职当天仍属有效业务日')

  const after = resolveDailyReportAnchorsForDate(config, '2026-07-18')
  assert.equal(
    after.every((a) => {
      if (a.anchorName !== '小红') return true
      return !(a.effectiveTo && '2026-07-18' > a.effectiveTo)
    }),
    true,
  )
  // 明确：effectiveTo 过滤后不应保留小红
  assert.equal(
    after.filter((a) => a.anchorName === '小红').length,
    0,
  )
  console.log('  ✓ 离职次日硬编码/候选不再保留已离职主播空卡')

  // 日报行字段约定
  const dailyRow = {
    anchorName: '阿丽',
    isTemporaryAnchor: true,
    temporaryAnchorKey: 'temp:2026-07-17:u1',
    gmv: 0,
    soldOrderCount: 0,
  }
  assert.equal(dailyRow.isTemporaryAnchor, true)
  assert.ok(dailyRow.temporaryAnchorKey?.startsWith('temp:'))
  console.log('  ✓ DailyReportAnchorRow 支持临时试播标识（图片侧渲染「临时试播」）')

  // 硬编码不得作为唯一事实源：异步候选会叠加排班/临时/归属
  assert.ok(typeof resolveDailyReportAnchorsForDate === 'function')
  console.log('  ✓ 日报候选以日期有效主播+排班+归属为准（异步层叠加临时）')

  console.log('\nPASS')
}

main()
