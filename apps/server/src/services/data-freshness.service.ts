import { prisma } from '../lib/prisma'
import { startOfDayMsShanghai, endOfDayMsShanghai } from '../utils/business-timezone'
import { getBusinessSyncStatus } from './business-sync-scheduler.service'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface DataFreshnessPayload {
  startDate: string
  endDate: string
  /** 当前报表日期范围内，最新一笔订单的时间 */
  latestOrderTime: string | null
  /** 最近一次从小红书千帆拉取成功的时间 */
  lastQianfanSyncAt: string | null
}

export async function resolveLatestOrderTimeInRange(
  startDate: string,
  endDate: string,
): Promise<string | null> {
  const agg = await prisma.xhsRawOrder.aggregate({
    where: {
      orderTime: {
        gte: new Date(startOfDayMsShanghai(startDate)),
        lte: new Date(endOfDayMsShanghai(endDate)),
      },
    },
    _max: { orderTime: true },
  })
  return agg._max.orderTime?.toISOString() ?? null
}

export async function getDataFreshness(
  startDate: string,
  endDate: string,
): Promise<DataFreshnessPayload> {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new Error('日期格式应为 YYYY-MM-DD')
  }
  if (startDate > endDate) {
    throw new Error('开始日期不能晚于结束日期')
  }

  const [latestOrderTime, syncStatus] = await Promise.all([
    resolveLatestOrderTimeInRange(startDate, endDate),
    getBusinessSyncStatus(),
  ])

  return {
    startDate,
    endDate,
    latestOrderTime,
    lastQianfanSyncAt: syncStatus.businessSync.lastSuccessAt,
  }
}
