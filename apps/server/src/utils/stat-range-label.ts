import { formatDateKey, resolveDateRange } from './date-range'

export interface StatRangeMeta {
  startDate: string
  endDate: string
  queryStartTime: string
  queryEndTime: string
  windowLabel: string
  includesTodayRealtime: boolean
  payAmountTimeField: string
  masterOrderTimeField: string
  afterSaleTimeField: string
}

/** 经营看板 / 导出 / 验收脚本的统计窗口说明 */
export function buildStatRangeMeta(startDate: string, endDate: string): StatRangeMeta {
  const range = resolveDateRange('custom', startDate, endDate)
  const today = formatDateKey(new Date())
  const includesTodayRealtime = range.endDate === today
  const queryStartTime = `${range.startDate} 00:00:00`
  const queryEndTime = includesTodayRealtime
    ? `${range.endDate}（含今日实时订单，截止 ${formatDateKey(new Date())} 当日末）`
    : `${range.endDate} 23:59:59`
  const windowLabel = includesTodayRealtime
    ? `${queryStartTime} ~ ${range.endDate}（含今日实时订单）`
    : `${queryStartTime} ~ ${queryEndTime}`

  return {
    startDate: range.startDate,
    endDate: range.endDate,
    queryStartTime,
    queryEndTime,
    windowLabel,
    includesTodayRealtime,
    payAmountTimeField: '支付时间（统计周期内已支付订单）',
    masterOrderTimeField: '订单归属时间（优先支付时间，无则下单时间；与订单接口查询范围一致）',
    afterSaleTimeField: '售后申请/退款时间（按扩窗从接口分页拉取，仅匹配主表订单后计入指标）',
  }
}
