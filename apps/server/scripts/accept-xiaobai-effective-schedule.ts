/**
 * 小白有效排班归属验收（模板虚排 + 边界）
 *
 * npx tsx apps/server/scripts/accept-xiaobai-effective-schedule.ts
 */
import assert from 'node:assert/strict'
import {
  clearCanonicalAttributionCache,
  resolveCanonicalOrderAttribution,
  setCanonicalAttributionTestFixtures,
} from '../src/services/canonical-order-attribution.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

function ms(text: string): number {
  return Date.parse(text.replace(' ', 'T') + '+08:00')
}

function stubView(
  partial: Partial<AnalyzedOrderView> & { raw?: Record<string, unknown> },
): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    displayOrderNo: 'P-XB',
    officialOrderNo: 'P-XB',
    matchOrderId: 'P-XB',
    liveAccountName: 'XY祥钰珠宝',
    anchorId: '',
    anchorName: '未归属',
    orderTimeText: '—',
    ...partial,
  } as AnalyzedOrderView & { raw?: Record<string, unknown> }
}

async function main(): Promise<void> {
  clearCanonicalAttributionCache()

  // 1) 6月模板 14:30–18:00
  setCanonicalAttributionTestFixtures({
    liveSessions: [],
    effectiveSchedules: [
      {
        id: 'june-xb',
        anchorName: '小白',
        shopName: 'XY祥钰珠宝',
        liveRoomName: 'XY祥钰珠宝',
        startAt: new Date(ms('2026-06-20 14:30:00')),
        endAt: new Date(ms('2026-06-20 18:00:00')),
        source: 'virtual_template',
      },
    ],
  })
  {
    const hit = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-06-20 14:30:00', createTime: '2026-06-20 14:30:00' },
      }),
    )
    assert.equal(hit.canonicalAnchorName, '小白')
    assert.equal(hit.attributionType, 'virtual_template')

    const endExclusive = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-06-20 18:00:00', createTime: '2026-06-20 18:00:00' },
      }),
    )
    assert.equal(endExclusive.canonicalAnchorName, '未归属')

    const payInSlotCreateOut = await resolveCanonicalOrderAttribution(
      stubView({
        raw: {
          orderedAt: '2026-06-20 18:30:00',
          createTime: '2026-06-20 18:30:00',
          payTime: '2026-06-20 16:00:00',
        },
      }),
    )
    assert.equal(
      payInSlotCreateOut.canonicalAnchorName,
      '未归属',
      '禁止用支付时间归属：下单已过午场',
    )
  }

  // 2) 7月模板 14:00–18:30
  setCanonicalAttributionTestFixtures({
    liveSessions: [],
    effectiveSchedules: [
      {
        id: 'jul-xb',
        anchorName: '小白',
        shopName: 'XY祥钰珠宝',
        liveRoomName: 'XY祥钰珠宝',
        startAt: new Date(ms('2026-07-03 14:00:00')),
        endAt: new Date(ms('2026-07-03 18:30:00')),
        source: 'virtual_template',
      },
    ],
  })
  {
    const before = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-07-03 13:59:59', createTime: '2026-07-03 13:59:59' },
      }),
    )
    assert.equal(before.canonicalAnchorName, '未归属')
    const hit = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-07-03 14:00:00', createTime: '2026-07-03 14:00:00' },
      }),
    )
    assert.equal(hit.canonicalAnchorName, '小白')
    const endExclusive = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-07-03 18:30:00', createTime: '2026-07-03 18:30:00' },
      }),
    )
    assert.equal(endExclusive.canonicalAnchorName, '未归属')
  }

  // 3) 非祥钰排除
  setCanonicalAttributionTestFixtures({
    liveSessions: [],
    effectiveSchedules: [
      {
        id: 'june-xb',
        anchorName: '小白',
        shopName: 'XY祥钰珠宝',
        liveRoomName: 'XY祥钰珠宝',
        startAt: new Date(ms('2026-06-20 14:30:00')),
        endAt: new Date(ms('2026-06-20 18:00:00')),
        source: 'virtual_template',
      },
    ],
  })
  {
    for (const shop of ['和田雅玉', '拾玉居和田玉'] as const) {
      const r = await resolveCanonicalOrderAttribution(
        stubView({
          liveAccountName: shop,
          raw: { orderedAt: '2026-06-20 16:00:00', createTime: '2026-06-20 16:00:00' },
        }),
      )
      assert.equal(r.canonicalAnchorName, '未归属', `${shop} 不应吃到祥钰小白排班`)
    }
  }

  // 4) 真实场次优先于模板
  setCanonicalAttributionTestFixtures({
    liveSessions: [
      {
        liveId: 'live-zy',
        anchorName: '子杰',
        liveAccountName: 'XY祥钰珠宝',
        startMs: ms('2026-06-20 14:30:00'),
        endMs: ms('2026-06-20 18:00:00'),
      },
    ],
    effectiveSchedules: [
      {
        id: 'june-xb',
        anchorName: '小白',
        shopName: 'XY祥钰珠宝',
        liveRoomName: 'XY祥钰珠宝',
        startAt: new Date(ms('2026-06-20 14:30:00')),
        endAt: new Date(ms('2026-06-20 18:00:00')),
        source: 'virtual_template',
      },
    ],
  })
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-06-20 16:00:00', createTime: '2026-06-20 16:00:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '子杰')
    assert.equal(r.attributionType, 'live_session')
  }

  setCanonicalAttributionTestFixtures(null)
  clearCanonicalAttributionCache()
  console.log('PASS: accept-xiaobai-effective-schedule')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
