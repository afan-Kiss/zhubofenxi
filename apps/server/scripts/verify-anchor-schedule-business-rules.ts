/**
 * 主播排班业务规则验收
 * 用法: npm run verify:anchor-schedule-business-rules
 */
import assert from 'node:assert/strict'
import { buildScheduleBounds, detectScheduleConflicts } from '../src/utils/anchor-schedule-time.util'
import { buildEffectiveScheduleRowsForDate } from '../src/utils/anchor-effective-schedule.util'
import {
  NEW_SCHEDULE_TEMPLATE_SEEDS_20260701,
  validateScheduleDraft,
} from '../src/services/anchor-schedule-template.service'
import type { EffectiveScheduleRow } from '../src/services/anchor-daily-schedule.service'
import type { DailyReportLiveSession } from '../src/services/daily-report-live-sessions.service'
import { assignDailyReportLiveSessionsToAnchors } from '../src/services/daily-report-live-sessions.service'
import { buildPerSessionLivePeriodText } from '../src/services/daily-report-live-schedule-match.service'
import type { GoodReviewShopKey } from '../src/config/good-review-shops.constants'

const DATE = '2026-07-04'

function templateRecords() {
  return NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.map((t, i) => ({
    id: `tpl-${i}`,
    anchorName: t.anchorName,
    shopName: t.shopName,
    liveRoomName: t.liveRoomName,
    startTime: t.startTime,
    endTime: t.endTime,
    effectiveFrom: t.effectiveFrom,
    effectiveTo: t.effectiveTo,
    enabled: true,
    sortOrder: t.sortOrder,
    note: t.note ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
}

function manualDbRow(
  id: string,
  anchorName: string,
  shopName: string,
  startTime: string,
  endTime: string,
) {
  const { startAt, endAt } = buildScheduleBounds(DATE, startTime, endTime)
  return {
    id,
    scheduleDate: DATE,
    anchorName,
    shopName,
    liveRoomName: shopName,
    startAt,
    endAt,
    source: 'manual',
    enabled: true,
    confirmed: false,
    note: null,
  }
}

function scheduleRowFromTemplate(
  seed: (typeof NEW_SCHEDULE_TEMPLATE_SEEDS_20260701)[number],
  idx: number,
): EffectiveScheduleRow {
  const { startAt, endAt } = buildScheduleBounds(DATE, seed.startTime, seed.endTime)
  return {
    rowId: `eff-${idx}`,
    source: 'virtual_template',
    anchorName: seed.anchorName,
    shopName: seed.shopName,
    liveRoomName: seed.liveRoomName,
    startTime: seed.startTime,
    endTime: seed.endTime,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    enabled: true,
    confirmed: false,
    note: seed.note,
  }
}

function liveSession(
  shopName: string,
  shopCode: GoodReviewShopKey,
  liveId: string,
  startHm: string,
  endHm: string,
): DailyReportLiveSession {
  const startTime = `${DATE} ${startHm}:00`
  const endTime = `${DATE} ${endHm}:00`
  const startMs = Date.parse(`${DATE}T${startHm}:00+08:00`)
  const endMs = Date.parse(`${DATE}T${endHm}:00+08:00`)
  return {
    liveId,
    liveName: shopName,
    liveAccountName: shopName,
    startTime,
    endTime,
    durationMinutes: Math.round((endMs - startMs) / 60_000),
    durationText: 'test',
    viewSessionCount: null,
    joinUserCount: null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: null,
    dealUserCount: null,
    sourceShopCode: shopCode,
    sourceShopName: shopName,
    sellerRealIncomeAmtYuan: 1000,
    dealOrderCnt: 10,
    refundAmtYuan: 0,
  }
}

function resolveAnchorFromAssignment(
  assignment: ReturnType<typeof assignDailyReportLiveSessionsToAnchors>,
  payMs: number,
): string | null {
  for (const [anchorName, sessions] of assignment.byAnchor.entries()) {
    for (const session of sessions) {
      const startMs = Date.parse(session.startTime.replace(' ', 'T') + '+08:00')
      const endMs = Date.parse(session.endTime.replace(' ', 'T') + '+08:00')
      if (payMs >= startMs && payMs <= endMs) return anchorName
    }
  }
  return null
}

function main(): void {
  const templates = NEW_SCHEDULE_TEMPLATE_SEEDS_20260701
  const records = templateRecords()

  const s1 = buildEffectiveScheduleRowsForDate({
    dateKey: DATE,
    dateConfirmed: false,
    dbRows: [],
    templates,
    templateRecords: records,
  })
  assert.equal(s1.rows.length, 5, '场景1 应有 5 条有效排班')
  for (const seed of templates) {
    assert.ok(
      s1.rows.some(
        (r) =>
          r.anchorName === seed.anchorName &&
          r.shopName === seed.shopName &&
          r.startTime === seed.startTime &&
          r.endTime === seed.endTime,
      ),
      `场景1 缺少 ${seed.anchorName} ${seed.shopName} ${seed.startTime}-${seed.endTime}`,
    )
  }
  assert.equal(s1.sourceSummary.virtualCount, 5)
  console.log('PASS 场景1: 默认 5 条排班')

  const s2 = buildEffectiveScheduleRowsForDate({
    dateKey: DATE,
    dateConfirmed: false,
    dbRows: [manualDbRow('m-xb', '小白', 'XY祥钰珠宝', '14:20', '18:30')],
    templates,
    templateRecords: records,
  })
  assert.equal(s2.rows.length, 5, '场景2 仍应有 5 条')
  const xb = s2.rows.find((r) => r.anchorName === '小白')!
  assert.equal(xb.source, 'manual')
  assert.equal(xb.startTime, '14:20')
  assert.ok(s2.rows.some((r) => r.anchorName === '子杰'), '场景2 子杰仍在')
  assert.ok(s2.rows.some((r) => r.anchorName === '飞云'), '场景2 飞云仍在')
  console.log('PASS 场景2: 部分 manual 覆盖默认')

  const fullManual = templates.map((t, i) =>
    manualDbRow(`m-${i}`, t.anchorName, t.shopName, t.startTime, t.endTime),
  )
  const s3 = buildEffectiveScheduleRowsForDate({
    dateKey: DATE,
    dateConfirmed: true,
    dbRows: fullManual,
    templates,
    templateRecords: records,
  })
  assert.equal(s3.rows.length, 5)
  assert.equal(s3.sourceSummary.manualCount, 5)
  assert.equal(s3.sourceSummary.virtualCount, 0)
  console.log('PASS 场景3: 完整 manual 不重复补齐')

  const dupAnchor = validateScheduleDraft(DATE, [
    {
      anchorName: '小红',
      shopName: '和田雅玉',
      liveRoomName: '和田雅玉',
      startTime: '09:00',
      endTime: '12:00',
    },
    {
      anchorName: '小红',
      shopName: '和田雅玉',
      liveRoomName: '和田雅玉',
      startTime: '14:00',
      endTime: '18:00',
    },
  ])
  assert.equal(dupAnchor.ok, false)
  assert.ok(
    dupAnchor.conflicts.some((c) => c.message.includes('小红今天已经有一条排班了')),
    '场景4 文案',
  )
  console.log('PASS 场景4: 同主播多条排班失败')

  const shopOverlap = detectScheduleConflicts([
    {
      anchorName: '小艺',
      shopName: '和田雅玉',
      liveRoomName: '和田雅玉',
      ...buildScheduleBounds(DATE, '14:00', '18:30'),
    },
    {
      anchorName: '小红',
      shopName: '和田雅玉',
      liveRoomName: '和田雅玉',
      ...buildScheduleBounds(DATE, '15:00', '17:00'),
    },
  ])
  assert.ok(
    shopOverlap.some((c) => c.message.includes('不能再排其他主播')),
    `场景5 文案: ${shopOverlap.map((c) => c.message).join('; ')}`,
  )
  console.log('PASS 场景5: 同店重叠失败')

  const defaultSchedules = templates.map((t, i) => scheduleRowFromTemplate(t, i))
  const zijieLive = liveSession('拾玉居和田玉', 'shiyuju', 'live-zijie-0704', '09:20', '14:02')
  const assign6 = assignDailyReportLiveSessionsToAnchors([zijieLive], defaultSchedules, DATE)
  assert.ok(assign6.byAnchor.has('子杰'), '场景6 应识别子杰')
  const zijiePeriod = buildPerSessionLivePeriodText(assign6.byAnchor.get('子杰') ?? [])
  assert.ok(zijiePeriod.includes('09:20'), `场景6 显示实际开播: ${zijiePeriod}`)
  const pay0925 = Date.parse(`${DATE}T09:25:00+08:00`)
  const pay0940 = Date.parse(`${DATE}T09:40:00+08:00`)
  assert.equal(resolveAnchorFromAssignment(assign6, pay0925), '子杰')
  assert.equal(resolveAnchorFromAssignment(assign6, pay0940), '子杰')
  console.log('PASS 场景6: 早开/晚下识别子杰')

  const htSchedules = defaultSchedules.filter((r) => r.shopName === '和田雅玉')
  const crossLive = liveSession('和田雅玉', 'hty', 'live-ht-cross', '13:50', '18:40')
  const assign7 = assignDailyReportLiveSessionsToAnchors([crossLive], htSchedules, DATE)
  assert.equal(buildPerSessionLivePeriodText(assign7.byAnchor.get('小红') ?? []), '13:50~14:00')
  assert.ok(
    buildPerSessionLivePeriodText(assign7.byAnchor.get('小艺') ?? []).includes('14:00'),
    '场景7 小艺从 14:00 起',
  )
  const pay1359 = Date.parse(`${DATE}T13:59:00+08:00`)
  const pay1401 = Date.parse(`${DATE}T14:01:00+08:00`)
  assert.equal(resolveAnchorFromAssignment(assign7, pay1359), '小红')
  assert.equal(resolveAnchorFromAssignment(assign7, pay1401), '小艺')
  console.log('PASS 场景7: 同店相邻边界切分')

  const s8Manual = [
    manualDbRow('m-zj', '子杰', '拾玉居和田玉', '09:30', '14:00'),
    manualDbRow('m-xh', '小红', 'XY祥钰珠宝', '14:15', '18:30'),
    manualDbRow('m-xy', '小艺', '和田雅玉', '14:10', '18:10'),
    manualDbRow('m-fy', '飞云', '拾玉居和田玉', '18:30', '23:40'),
  ]
  const s8 = buildEffectiveScheduleRowsForDate({
    dateKey: DATE,
    dateConfirmed: true,
    dbRows: s8Manual,
    templates,
    templateRecords: records,
  })
  assert.equal(s8.rows.length, 4, '场景8 生效排班应为 4 条')
  assert.equal(s8.sourceSummary.manualCount, 4)
  assert.equal(s8.sourceSummary.virtualCount, 0)
  const s8Xiaohong = s8.rows.filter((r) => r.anchorName === '小红')
  assert.equal(s8Xiaohong.length, 1, '场景8 小红只出现 1 条')
  assert.equal(s8Xiaohong[0]!.shopName, 'XY祥钰珠宝')
  assert.equal(s8Xiaohong[0]!.startTime, '14:15')
  assert.ok(!s8.rows.some((r) => r.anchorName === '小白'), '场景8 不应出现小白')
  assert.ok(
    !s8.rows.some(
      (r) => r.anchorName === '小红' && r.shopName === '和田雅玉' && r.startTime === '09:30',
    ),
    '场景8 不应出现小红和田雅玉早场',
  )
  assert.ok(
    !s8.warnings.some((w) => w.includes('当天出现') && w.includes('条生效排班')),
    `场景8 不应有同主播重复 warning: ${s8.warnings.join('; ')}`,
  )

  const s8Next = buildEffectiveScheduleRowsForDate({
    dateKey: '2026-07-05',
    dateConfirmed: false,
    dbRows: [],
    templates,
    templateRecords: records,
  })
  assert.equal(s8Next.rows.length, 5, '场景8 2026-07-05 仍应有 5 条默认模板')
  assert.equal(s8Next.sourceSummary.virtualCount, 5)
  console.log('PASS 场景8: 2026-07-04 小红只有手动午场')

  console.log('verify-anchor-schedule-business-rules: ALL PASS')
}

main()
