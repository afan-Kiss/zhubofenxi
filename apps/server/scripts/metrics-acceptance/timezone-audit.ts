import { resolveDateRange } from '../../src/utils/date-range'
import {
  endOfDayMsShanghai,
  startOfDayMsShanghai,
} from '../../src/utils/business-timezone'
import { logFail, logPass } from './assertions'

const TEST_DATE = '2026-05-28'

export function auditShanghaiDateRange(): void {
  const custom = resolveDateRange('custom', TEST_DATE, TEST_DATE)
  const expectedStart = startOfDayMsShanghai(TEST_DATE)
  const expectedEnd = endOfDayMsShanghai(TEST_DATE)

  if (custom.startDate === TEST_DATE && custom.endDate === TEST_DATE) {
    logPass('timezone:custom:keys', `OK ${TEST_DATE}~${TEST_DATE}`)
  } else {
    logFail({
      name: 'timezone:custom:keys',
      message: '自定义日期键不正确',
      expected: `${TEST_DATE}~${TEST_DATE}`,
      actual: `${custom.startDate}~${custom.endDate}`,
    })
  }

  if (custom.startTimeMs === expectedStart) {
    logPass('timezone:custom:start', `OK start=${custom.startTimeMs}`)
  } else {
    logFail({
      name: 'timezone:custom:start',
      message: 'startTimeMs 应为 Asia/Shanghai 00:00:00',
      expected: expectedStart,
      actual: custom.startTimeMs,
    })
  }

  if (custom.endTimeMs === expectedEnd) {
    logPass('timezone:custom:end', `OK end=${custom.endTimeMs}`)
  } else {
    logFail({
      name: 'timezone:custom:end',
      message: 'endTimeMs 应为 Asia/Shanghai 23:59:59.999',
      expected: expectedEnd,
      actual: custom.endTimeMs,
    })
  }

  const thisMonth = resolveDateRange('thisMonth')
  const lastMonth = resolveDateRange('lastMonth')
  if (thisMonth.endDate >= thisMonth.startDate && lastMonth.endDate >= lastMonth.startDate) {
    logPass(
      'timezone:preset:month',
      `OK thisMonth=${thisMonth.startDate}~${thisMonth.endDate} lastMonth=${lastMonth.startDate}~${lastMonth.endDate}`,
    )
  } else {
    logFail({
      name: 'timezone:preset:month',
      message: 'thisMonth/lastMonth 范围无效',
      fields: { thisMonth, lastMonth },
    })
  }

  const midnightOrderMs = Date.parse('2026-05-28T00:00:00+08:00')
  const endOrderMs = Date.parse('2026-05-28T23:59:59+08:00')
  if (midnightOrderMs >= expectedStart && midnightOrderMs <= expectedEnd) {
    logPass('timezone:boundary:midnight', 'OK 00:00:00 订单在范围内')
  } else {
    logFail({
      name: 'timezone:boundary:midnight',
      message: '00:00:00 边界订单可能被漏掉',
      expected: `${expectedStart}~${expectedEnd}`,
      actual: midnightOrderMs,
    })
  }
  if (endOrderMs >= expectedStart && endOrderMs <= expectedEnd) {
    logPass('timezone:boundary:end', 'OK 23:59:59 订单在范围内')
  } else {
    logFail({
      name: 'timezone:boundary:end',
      message: '23:59:59 边界订单可能被漏掉',
      expected: `${expectedStart}~${expectedEnd}`,
      actual: endOrderMs,
    })
  }
}
