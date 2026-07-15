/**
 * 直播大屏流量字段抽取验收（封面点击率 / 60s停留 / 曝光 / 观看支付率）
 * 用法: npx tsx apps/server/scripts/accept-live-realtime-traffic-metrics.ts
 */
import {
  aggregateLiveSessionTraffic,
  extractLiveSessionTraffic,
  isCoverClickRateQualified,
  COVER_CLICK_RATE_PASS_THRESHOLD,
} from '../src/services/live-session-traffic.util'
import {
  extractRoomDataInfo,
  mergeRealtimeMetricIntoLiveRaw,
} from '../src/services/xhs-api-sync/xhs-live-realtime-metric.service'

function assert(cond: boolean, msg: string, issues: string[]): void {
  if (!cond) issues.push(msg)
}

function main(): void {
  const issues: string[] = []

  // sellerLiveDetailData 形态（value 包装）
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

  // 大屏 room_data_info 合并后
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
  // 加权：(0.1*1000 + 0.04*3000)/4000 = 0.055
  assert(
    agg.coverClickRate != null && Math.abs(agg.coverClickRate - 0.055) < 1e-9,
    '封面点击率应按曝光加权平均',
    issues,
  )

  if (issues.length) {
    console.error('FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('PASS accept-live-realtime-traffic-metrics')
}

main()
