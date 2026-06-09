import { prisma } from '../lib/prisma'

import { getDatabasePath, getPort } from '../config/env'

import { getApiSyncSettings } from './system-setting.service'

import {

  BUSINESS_SYNC_LOOKBACK_DAYS,

  getBusinessSyncStatus,

} from './business-sync-scheduler.service'

import { BUYER_RANKING_DAILY_TIME } from './scheduler.service'

import { buildLogSwitchStatusLines, logInfo } from '../utils/server-log'

import { formatDateTime } from '../utils/time'



let summaryPrinted = false



export async function printStartupSummary(): Promise<void> {

  if (summaryPrinted) return

  summaryPrinted = true



  const port = getPort()

  const [orderAgg, syncStatus, apiSettings] = await Promise.all([

    prisma.xhsRawOrder.aggregate({

      _count: true,

      _min: { orderTime: true },

      _max: { orderTime: true },

    }),

    getBusinessSyncStatus(),

    getApiSyncSettings(),

  ])



  const dbPath = getDatabasePath()

  const relDb = dbPath.includes('apps\\server\\')

    ? dbPath.slice(dbPath.indexOf('apps\\server\\')).replace(/\\/g, '/')

    : dbPath.includes('apps/server/')

      ? dbPath.slice(dbPath.indexOf('apps/server/'))

      : 'apps/server/data/app.db'



  const rangeStart = orderAgg._min.orderTime

    ? formatDateTime(orderAgg._min.orderTime)

    : '—'

  const rangeEnd = orderAgg._max.orderTime ? formatDateTime(orderAgg._max.orderTime) : '—'

  const lastSync = syncStatus.businessSync.lastSuccessAt

    ? formatDateTime(new Date(syncStatus.businessSync.lastSuccessAt))

    : '—'



  const intervalMinutes = syncStatus.businessSync.intervalMinutes

  const autoSyncLine = apiSettings.apiSyncEnabled

    ? `已开启，每 ${intervalMinutes} 分钟一次`

    : '已关闭'



  const lines = [

    '==================================================',

    '主播分析软件已启动',

    `本机访问：http://127.0.0.1:${port}`,

    `服务端口：${port}`,

    `数据库：${relDb}`,

    `经营数据自动同步：${autoSyncLine}`,

    `自动同步范围：最近 ${BUSINESS_SYNC_LOOKBACK_DAYS} 天订单 / 售后 / 官方品退`,

    `买家排行：每日 ${BUYER_RANKING_DAILY_TIME} 自动重建`,

    `当前数据范围：${rangeStart} ~ ${rangeEnd}`,

    `本地订单数：${orderAgg._count}`,

    `最后同步：${lastSync}`,

    ...buildLogSwitchStatusLines(),

    '==================================================',

  ]



  for (const line of lines) {

    if (line.startsWith('=')) {

      console.log(line)

    } else {

      logInfo('启动汇总', line)

    }

  }

}

