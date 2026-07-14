/**
 * 小白人工排班 + legacy 日期门控验收
 *
 * 覆盖：入职日前警告、手工排班优先、6.13 后门控 legacy、午场边界、指标同源。
 *
 * npx tsx apps/server/scripts/accept-xiaobai-manual-schedule-legacy.ts
 */
import assert from 'node:assert/strict'
import {
  clearCanonicalAttributionCache,
  resolveCanonicalOrderAttribution,
  remapViewsWithCanonicalAttribution,
  setCanonicalAttributionTestFixtures,
  canonicalAttributionLabel,
  CANONICAL_ATTRIBUTION_VERSION,
} from '../src/services/canonical-order-attribution.service'
import { xiaobaiWarningForDate } from '../src/services/anchor-schedule-template.service'
import { clearScheduleAttributionCache } from '../src/services/anchor-schedule-attribution.service'
import { refreshAnchorConfigCache } from '../src/services/anchor.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

function ms(text: string): number {
  return Date.parse(text.replace(' ', 'T') + '+08:00')
}

function stubView(
  partial: Partial<AnalyzedOrderView> & { raw?: Record<string, unknown> },
): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    displayOrderNo: 'P-XB-MANUAL',
    officialOrderNo: 'P-XB-MANUAL',
    matchOrderId: 'P-XB-MANUAL',
    liveAccountName: 'XY祥钰珠宝',
    anchorId: '',
    anchorName: '未归属',
    orderTimeText: '—',
    paymentBaseCent: 10_000,
    actualSignedAmountCent: 8_000,
    boardRefundAmountCent: 500,
    includedInGmv: true,
    ...partial,
  } as AnalyzedOrderView & { raw?: Record<string, unknown> }
}

async function main(): Promise<void> {
  await refreshAnchorConfigCache()
  clearCanonicalAttributionCache()
  assert.match(CANONICAL_ATTRIBUTION_VERSION, /canonical-v4-manual-schedule/)
  assert.equal(canonicalAttributionLabel('manual_schedule'), '人工排班归属')

  // 1) 2026-06-17 入职日前警告
  {
    const warn = xiaobaiWarningForDate('2026-06-17')
    assert.ok(warn && /小白|入职|06-18|6\.18|6月18/.test(warn), `expect hire warning, got: ${warn}`)
  }

  // 2) 2026-06-18 手动排班小白 → 归小白
  setCanonicalAttributionTestFixtures({
    liveSessions: [],
    effectiveSchedules: [
      {
        id: 'manual-0618',
        anchorName: '小白',
        shopName: 'XY祥钰珠宝',
        liveRoomName: 'XY祥钰珠宝',
        startAt: new Date(ms('2026-06-18 14:30:00')),
        endAt: new Date(ms('2026-06-18 18:00:00')),
        source: 'manual',
      },
    ],
  })
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-06-18 15:00:00', createTime: '2026-06-18 15:00:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小白')
    assert.equal(r.attributionType, 'manual_schedule')
    assert.equal(r.matchedScheduleId, 'manual-0618')
  }

  // 3) 2026-06-20 15:00，手动小白，原子杰 → 小白
  setCanonicalAttributionTestFixtures({
    liveSessions: [],
    effectiveSchedules: [
      {
        id: 'manual-0620',
        anchorName: '小白',
        shopName: 'XY祥钰珠宝',
        liveRoomName: 'XY祥钰珠宝',
        startAt: new Date(ms('2026-06-20 14:30:00')),
        endAt: new Date(ms('2026-06-20 18:00:00')),
        source: 'manual',
      },
    ],
  })
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        anchorName: '子杰',
        anchorId: 'zijie',
        raw: { orderedAt: '2026-06-20 15:00:00', createTime: '2026-06-20 15:00:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小白')
    assert.equal(r.attributionType, 'manual_schedule')
  }

  // 4) 原主播小艺 → 小白
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        anchorName: '小艺',
        raw: { orderedAt: '2026-06-20 15:00:00', createTime: '2026-06-20 15:00:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小白')
    assert.equal(r.attributionType, 'manual_schedule')
  }

  // 5) 6.26 手动小白不得保留原主播；且优先于真实场次
  setCanonicalAttributionTestFixtures({
    liveSessions: [
      {
        liveId: 'live-zy',
        anchorName: '子杰',
        liveAccountName: 'XY祥钰珠宝',
        startMs: ms('2026-06-26 14:30:00'),
        endMs: ms('2026-06-26 18:00:00'),
      },
    ],
    effectiveSchedules: [
      {
        id: 'manual-0626',
        anchorName: '小白',
        shopName: 'XY祥钰珠宝',
        liveRoomName: 'XY祥钰珠宝',
        startAt: new Date(ms('2026-06-26 14:30:00')),
        endAt: new Date(ms('2026-06-26 18:00:00')),
        source: 'manual',
      },
    ],
  })
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        anchorName: '子杰',
        raw: { orderedAt: '2026-06-26 16:00:00', createTime: '2026-06-26 16:00:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小白')
    assert.equal(r.attributionType, 'manual_schedule')
  }

  // 6–8) 固定午场边界（无排班时走小白固定规则）
  setCanonicalAttributionTestFixtures({ liveSessions: [], effectiveSchedules: [] })
  {
    const start = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-06-20 14:30:00', createTime: '2026-06-20 14:30:00' },
      }),
    )
    assert.equal(start.canonicalAnchorName, '小白', '14:30 命中小白')

    const beforeEnd = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-06-20 17:59:59', createTime: '2026-06-20 17:59:59' },
      }),
    )
    assert.equal(beforeEnd.canonicalAnchorName, '小白', '17:59:59 命中小白')

    const atEnd = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-06-20 18:00:00', createTime: '2026-06-20 18:00:00' },
      }),
    )
    assert.notEqual(atEnd.canonicalAnchorName, '小白', '18:00:00 不属于午场')
  }

  // 9) 7.01 起 14:00–18:30
  setCanonicalAttributionTestFixtures({ liveSessions: [], effectiveSchedules: [] })
  {
    const hit = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-07-01 14:00:00', createTime: '2026-07-01 14:00:00' },
      }),
    )
    assert.equal(hit.canonicalAnchorName, '小白')
    const late = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-07-01 18:29:59', createTime: '2026-07-01 18:29:59' },
      }),
    )
    assert.equal(late.canonicalAnchorName, '小白')
    const end = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-07-01 18:30:00', createTime: '2026-07-01 18:30:00' },
      }),
    )
    assert.notEqual(end.canonicalAnchorName, '小白')
  }

  // 10) 非祥钰不误命中固定规则
  setCanonicalAttributionTestFixtures({ liveSessions: [], effectiveSchedules: [] })
  {
    for (const shop of ['和田雅玉', '拾玉居和田玉'] as const) {
      const r = await resolveCanonicalOrderAttribution(
        stubView({
          liveAccountName: shop,
          raw: { orderedAt: '2026-06-20 15:00:00', createTime: '2026-06-20 15:00:00' },
        }),
      )
      assert.notEqual(r.canonicalAnchorName, '小白', `${shop} 不得命中小白固定规则`)
    }
  }

  // 11) 6.13 前 legacy 原主播仍可保留
  setCanonicalAttributionTestFixtures({ liveSessions: [], effectiveSchedules: [] })
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        anchorName: '子杰',
        raw: { orderedAt: '2026-06-05 10:30:00', createTime: '2026-06-05 10:30:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '子杰')
    assert.equal(r.attributionType, 'legacy_attribution')
  }

  // 12) 6.13 后不得用「原订单主播」legacy 兜底（解释不得含原订单主播）
  setCanonicalAttributionTestFixtures({ liveSessions: [], effectiveSchedules: [] })
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: '拾玉居和田玉',
        anchorName: '子杰',
        raw: { orderedAt: '2026-06-20 10:00:00', createTime: '2026-06-20 10:00:00' },
      }),
    )
    assert.ok(
      !/原订单主播/.test(r.attributionExplain),
      `6.13 后不得用 view.anchorName 兜底: ${r.attributionExplain}`,
    )
  }

  // 13–14) GMV/签收/退款/品退明细主播一致，卡片合计=明细
  setCanonicalAttributionTestFixtures({
    liveSessions: [],
    effectiveSchedules: [
      {
        id: 'manual-sum',
        anchorName: '小白',
        shopName: 'XY祥钰珠宝',
        liveRoomName: 'XY祥钰珠宝',
        startAt: new Date(ms('2026-06-20 14:30:00')),
        endAt: new Date(ms('2026-06-20 18:00:00')),
        source: 'manual',
      },
    ],
  })
  {
    const views = [
      stubView({
        displayOrderNo: 'A1',
        officialOrderNo: 'A1',
        matchOrderId: 'A1',
        anchorName: '子杰',
        paymentBaseCent: 12_000,
        actualSignedAmountCent: 10_000,
        boardRefundAmountCent: 1_000,
        raw: { orderedAt: '2026-06-20 15:00:00', createTime: '2026-06-20 15:00:00' },
      }),
      stubView({
        displayOrderNo: 'A2',
        officialOrderNo: 'A2',
        matchOrderId: 'A2',
        anchorName: '小艺',
        paymentBaseCent: 8_000,
        actualSignedAmountCent: 7_500,
        boardRefundAmountCent: 200,
        raw: { orderedAt: '2026-06-20 16:00:00', createTime: '2026-06-20 16:00:00' },
      }),
    ]
    const remapped = await remapViewsWithCanonicalAttribution(views)
    assert.ok(remapped.every((v) => v.anchorName === '小白'))
    assert.ok(remapped.every((v) => v.qualityAttributionAnchorName === '小白'))
    const gmv = remapped.reduce((s, v) => s + (v.paymentBaseCent ?? 0), 0)
    const signed = remapped.reduce((s, v) => s + (v.actualSignedAmountCent ?? 0), 0)
    const refund = remapped.reduce((s, v) => s + (v.boardRefundAmountCent ?? 0), 0)
    assert.equal(gmv, 20_000)
    assert.equal(signed, 17_500)
    assert.equal(refund, 1_200)
  }

  // 15) 手动排班修改后清除 canonical / 排班缓存
  {
    clearScheduleAttributionCache()
    clearCanonicalAttributionCache()
    setCanonicalAttributionTestFixtures({
      liveSessions: [],
      effectiveSchedules: [
        {
          id: 'manual-after-clear',
          anchorName: '小白',
          shopName: 'XY祥钰珠宝',
          liveRoomName: 'XY祥钰珠宝',
          startAt: new Date(ms('2026-06-21 14:30:00')),
          endAt: new Date(ms('2026-06-21 18:00:00')),
          source: 'manual',
        },
      ],
    })
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        raw: { orderedAt: '2026-06-21 15:00:00', createTime: '2026-06-21 15:00:00' },
      }),
    )
    assert.equal(r.matchedScheduleId, 'manual-after-clear')
  }

  // 16) 版本指纹变更后不得把旧快照当权威（指纹含 v4）
  assert.match(CANONICAL_ATTRIBUTION_VERSION, /v4/)

  setCanonicalAttributionTestFixtures(null)
  clearCanonicalAttributionCache()
  console.log('PASS: accept-xiaobai-manual-schedule-legacy')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
