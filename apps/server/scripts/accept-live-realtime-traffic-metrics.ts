/**
 * 直播大屏流量字段抽取验收（封面点击率 / 60s停留 / 曝光 / 观看支付率）
 * 用法: npx tsx apps/server/scripts/accept-live-realtime-traffic-metrics.ts
 */
import {
  aggregateLiveSessionTraffic,
  extractLiveSessionTraffic,
  isCoverClickRateQualified,
  parseLiveRateValue,
  COVER_CLICK_RATE_PASS_THRESHOLD,
} from '../src/services/live-session-traffic.util'
import {
  extractRoomDataInfo,
  liveRawNeedsRealtimeMetric,
  mergePreserveRealtimeMetricFields,
  mergeRealtimeMetricIntoLiveRaw,
} from '../src/services/xhs-api-sync/xhs-live-realtime-metric.service'
import {
  formatCoverClickRateWithQuality,
  formatPeopleCountOrMissing,
  resolveCoverClickRateQuality,
} from '../../web/src/components/board/dailyReportFormatters'

function assert(cond: boolean, msg: string, issues: string[]): void {
  if (!cond) issues.push(msg)
}

function main(): void {
  const issues: string[] = []

  // sellerLiveDetailData 形态（value 包装）——不得把缺失当成 0
  const fromList = extractLiveSessionTraffic({
    liveViewSessionCnt: { value: 1095 },
    serverLiveViewUserNum: { value: 826 },
    liveTotalImpressionCnt: { value: 15888 },
    viewPayRate: { value: 0.0036 },
    avgViewDuration: { value: 108.7 },
  })
  assert(fromList.impressionCount === 15888, '应从 liveTotalImpressionCnt 抽取曝光次数', issues)
  assert(fromList.viewPayRate === 0.0036, '应从 viewPayRate 抽取观看支付率', issues)
  assert(fromList.coverClickRate == null, '场次列表无封面点击率时应为 null', issues)
  assert(fromList.stay60sUserCount == null, '场次列表无 60s 停留时应为 null', issues)
  assert(
    liveRawNeedsRealtimeMetric({
      liveViewSessionCnt: { value: 1095 },
      serverLiveViewUserNum: { value: 826 },
    }),
    '无大屏字段时应需要补齐',
    issues,
  )

  // 1. live_ctr = 0.0522 → 5.22% 不合格
  {
    const q = resolveCoverClickRateQuality(0.0522)
    assert(q.status === 'fail', '0.0522 应为不合格', issues)
    assert(q.pctText === '5.2%', '0.0522 文案应为 5.2%', issues)
    assert(formatCoverClickRateWithQuality(0.0522) === '5.2% 不合格', '封面点击率文案', issues)
  }

  // 2. live_ctr = 0.08 → 合格
  {
    const q = resolveCoverClickRateQuality(0.08)
    assert(q.status === 'pass', '0.08 应合格', issues)
    assert(formatCoverClickRateWithQuality(0.08) === '8.0% 合格', '0.08 文案', issues)
  }

  // 3. live_ctr = null → 数据缺失（不得显示不合格）
  {
    const q = resolveCoverClickRateQuality(null)
    assert(q.status === 'missing', 'null 应为数据缺失', issues)
    assert(formatCoverClickRateWithQuality(null) === '数据缺失', 'null 文案', issues)
    assert(formatCoverClickRateWithQuality(undefined) === '数据缺失', 'undefined 文案', issues)
  }

  // 4 / 5. 60s 停留人数
  assert(formatPeopleCountOrMissing(138) === '138人', '138 应显示 138人', issues)
  assert(formatPeopleCountOrMissing(null) === '数据缺失', '60s 缺失应为数据缺失', issues)
  assert(formatPeopleCountOrMissing(undefined) === '数据缺失', '60s undefined 应为数据缺失', issues)

  // 6. value 包装可解析
  {
    const t = extractLiveSessionTraffic({
      live_ctr: { value: 0.0522 },
      live_view_over60s_user_num: { value: 138 },
    })
    assert(t.coverClickRate != null && Math.abs(t.coverClickRate - 0.0522) < 1e-9, 'value 包装 live_ctr', issues)
    assert(t.stay60sUserCount === 138, 'value 包装 60s', issues)
  }

  // 7. displayValue: "5.22%" 可解析
  {
    assert(parseLiveRateValue({ displayValue: '5.22%' }) != null, 'displayValue 5.22% 可解析', issues)
    assert(
      Math.abs((parseLiveRateValue({ displayValue: '5.22%' }) ?? 0) - 0.0522) < 1e-9,
      'displayValue 5.22% = 0.0522',
      issues,
    )
    const t = extractLiveSessionTraffic({ live_ctr: { displayValue: '5.22%' } })
    assert(t.coverClickRate != null && Math.abs(t.coverClickRate - 0.0522) < 1e-9, 'displayValue 抽取', issues)
  }

  // 大屏 room_data_info 合并后 + _realtimeMetricSyncedAt
  const harLikePayload = {
    code: 0,
    success: true,
    data: {
      room_data_info: {
        live_ctr: 0.052218344965104684,
        live_view_over60s_user_num: 138,
        live_total_impression_cnt: 15888,
        join_conversion_rate: 0.0036319612590799033,
        viewer_duration_avg: 108.75786924939467,
        join_uv: 826,
      },
    },
  }
  const roomInfo = extractRoomDataInfo(harLikePayload)
  assert(roomInfo != null, '应解析 room_data_info', issues)
  const merged = mergeRealtimeMetricIntoLiveRaw(
    {
      liveViewSessionCnt: { value: 1095 },
      liveTotalImpressionCnt: { value: 15888 },
      viewPayRate: { value: 0.003 },
    },
    roomInfo!,
  )
  // 8. 补齐成功后含 _realtimeMetricSyncedAt
  assert(typeof merged._realtimeMetricSyncedAt === 'string', '应写入 _realtimeMetricSyncedAt', issues)
  const fromMerged = extractLiveSessionTraffic(merged)
  assert(
    fromMerged.coverClickRate != null && Math.abs(fromMerged.coverClickRate - 0.052218344965104684) < 1e-9,
    '合并后应抽取封面点击率 live_ctr',
    issues,
  )
  assert(fromMerged.stay60sUserCount === 138, '合并后应抽取 60s 停留人数', issues)
  assert(fromMerged.impressionCount === 15888, '合并后曝光次数应保留', issues)
  assert(
    fromMerged.viewPayRate != null && Math.abs(fromMerged.viewPayRate - 0.0036319612590799033) < 1e-9,
    '合并后观看支付率应取 join_conversion_rate',
    issues,
  )
  assert(
    fromMerged.avgViewDurationSeconds != null &&
      Math.abs(fromMerged.avgViewDurationSeconds - 109) < 0.6,
    '合并后停留时长应取 viewer_duration_avg（取整秒）',
    issues,
  )
  assert(!liveRawNeedsRealtimeMetric(merged), '两个字段齐全后不应再需要补齐', issues)

  // 9. 已有有效字段不会被列表同步冲掉；且 needs=false 表示可跳过重复请求
  {
    const preserved = mergePreserveRealtimeMetricFields(merged, {
      liveId: 'x',
      liveViewSessionCnt: { value: 2000 },
    })
    assert(preserved.live_ctr != null, '列表 upsert 应保留 live_ctr', issues)
    assert(preserved.live_view_over60s_user_num != null, '列表 upsert 应保留 60s', issues)
    assert(preserved._realtimeMetricSyncedAt != null, '列表 upsert 应保留 syncedAt', issues)
    assert(!liveRawNeedsRealtimeMetric(preserved as Record<string, unknown>), '已有有效字段应跳过补齐', issues)
  }

  // 10. 单场失败不影响其他：纯逻辑 — 失败只记 warning，循环继续（用 needs 判定模拟）
  {
    const sessions = [
      { id: 'a', raw: merged },
      { id: 'b', raw: { liveId: 'bad' } },
      { id: 'c', raw: { live_ctr: 0.08, live_view_over60s_user_num: 10 } },
    ]
    const results: Array<{ id: string; action: string }> = []
    for (const s of sessions) {
      if (!liveRawNeedsRealtimeMetric(s.raw as Record<string, unknown>)) {
        results.push({ id: s.id, action: 'skip' })
        continue
      }
      // 模拟 b 失败、其余成功路径不中断
      if (s.id === 'b') {
        results.push({ id: s.id, action: 'fail' })
        continue
      }
      results.push({ id: s.id, action: 'enrich' })
    }
    assert(results.find((r) => r.id === 'a')?.action === 'skip', 'a 已完整应跳过', issues)
    assert(results.find((r) => r.id === 'b')?.action === 'fail', 'b 失败应记录', issues)
    assert(results.find((r) => r.id === 'c')?.action === 'skip', 'c 已完整应跳过', issues)
    assert(results.length === 3, '失败不应中断后续场次处理', issues)
  }

  assert(COVER_CLICK_RATE_PASS_THRESHOLD === 0.07, '封面点击率合格线应为 7%', issues)
  assert(isCoverClickRateQualified(0.07) === true, '7% 应合格', issues)
  assert(isCoverClickRateQualified(0.069) === false, '6.9% 应不合格', issues)
  assert(isCoverClickRateQualified(0.0522) === false, '5.22% 应不合格', issues)
  assert(isCoverClickRateQualified(null) === null, '缺失时应为 null', issues)

  const agg = aggregateLiveSessionTraffic([
    {
      viewSessionCount: 100,
      joinUserCount: 80,
      avgOnlineUserCount: 5,
      avgViewDurationSeconds: 100,
      newFollowerCount: 2,
      dealUserCount: 1,
      coverClickRate: 0.1,
      stay60sUserCount: 10,
      impressionCount: 1000,
      viewPayRate: 0.01,
    },
    {
      viewSessionCount: 200,
      joinUserCount: 120,
      avgOnlineUserCount: 8,
      avgViewDurationSeconds: 120,
      newFollowerCount: 3,
      dealUserCount: 2,
      coverClickRate: 0.04,
      stay60sUserCount: 20,
      impressionCount: 3000,
      viewPayRate: 0.002,
    },
  ])
  assert(agg.stay60sUserCount === 30, '多场 60s 停留应求和', issues)
  assert(agg.impressionCount === 4000, '多场曝光应求和', issues)
  assert(
    agg.coverClickRate != null && Math.abs(agg.coverClickRate - 0.055) < 1e-9,
    '封面点击率应按曝光加权平均',
    issues,
  )

  // 嵌套 room_data_info 直接抽取（未 flatten）
  {
    const nested = extractLiveSessionTraffic({
      data: {
        room_data_info: {
          live_ctr: 0.08,
          live_view_over60s_user_num: 50,
        },
      },
    })
    assert(nested.coverClickRate === 0.08, '嵌套 room_data_info 封面点击率', issues)
    assert(nested.stay60sUserCount === 50, '嵌套 room_data_info 60s', issues)
  }

  if (issues.length) {
    console.error('FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('PASS accept-live-realtime-traffic-metrics')
}

main()
