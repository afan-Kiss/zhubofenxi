/**
 * 系统设置「后台任务进度」聚合：大白话说明 + 可绑定进度条的百分数
 */
import { getBusinessSyncStatus } from './business-sync-scheduler.service'
import { getSyncStatusPayload } from './xhs-api-sync/xhs-sync-job.service'
import { getAfterSalesOpsSummary } from './after-sales-queue-audit.service'

export type RuntimeTaskStatus =
  | 'running'
  | 'idle'
  | 'paused'
  | 'waiting'
  | 'failed'
  | 'done'

export interface RuntimeTaskProgressItem {
  id: string
  kind: 'business_sync' | 'after_sales' | 'after_sales_shop' | 'buyer_ranking'
  title: string
  status: RuntimeTaskStatus
  /** 大白话当前状态 */
  statusText: string
  /** 补充说明（可空） */
  detailText: string | null
  /** 0–100；无法估算时为 null（前端显示等待动画，不假装百分比） */
  percent: number | null
  doneCount: number | null
  totalCount: number | null
  countLabel: string | null
}

export interface RuntimeProgressSnapshot {
  polledAt: string
  autoSyncEnabled: boolean
  anyRunning: boolean
  headline: string
  tasks: RuntimeTaskProgressItem[]
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '暂无'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function isAfterSalesBackfillMutexRunning(): boolean {
  const g = globalThis as { __afterSalesBackfillRunning?: boolean }
  return g.__afterSalesBackfillRunning === true
}

function buildBusinessSyncTask(
  enabled: boolean,
  biz: Awaited<ReturnType<typeof getBusinessSyncStatus>>['businessSync'],
  sync: Awaited<ReturnType<typeof getSyncStatusPayload>>,
): RuntimeTaskProgressItem {
  const job = sync.job

  // 手动同步不受 apiSyncEnabled 限制；关闭自动同步时仍可能正在跑
  if (sync.running && job) {
    const step =
      job.currentStepLabel?.trim() ||
      job.currentApiLabel?.trim() ||
      job.currentStep?.trim() ||
      '正在同步'
    const percent = clampPercent(Number(job.progress ?? 0))
    return {
      id: 'business_sync',
      kind: 'business_sync',
      title: '经营订单同步',
      status: 'running',
      statusText: enabled
        ? `正在同步经营数据：${step}`
        : `手动同步进行中（自动同步仍关闭）：${step}`,
      detailText: `已写入订单约 ${job.orderCount ?? 0} 笔；进度来自当前同步任务`,
      percent,
      doneCount: percent,
      totalCount: 100,
      countLabel: `${percent}%`,
    }
  }

  if (!enabled) {
    return {
      id: 'business_sync',
      kind: 'business_sync',
      title: '经营订单同步',
      status: 'paused',
      statusText: '自动同步已关闭，后台不会再自动去小红书拉订单',
      detailText: biz.lastSuccessAt
        ? `最近一次同步结束：${formatTime(biz.lastSuccessAt)}（仍可点「立即同步一次」）`
        : '还没有成功同步记录（仍可点「立即同步一次」）',
      percent: null,
      doneCount: null,
      totalCount: null,
      countLabel: null,
    }
  }

  if (biz.status === 'failed') {
    return {
      id: 'business_sync',
      kind: 'business_sync',
      title: '经营订单同步',
      status: 'failed',
      statusText: '最近一次经营同步失败',
      detailText: biz.lastError?.slice(0, 180) || biz.message || null,
      percent: null,
      doneCount: null,
      totalCount: null,
      countLabel: null,
    }
  }

  return {
    id: 'business_sync',
    kind: 'business_sync',
    title: '经营订单同步',
    status: 'idle',
    statusText: biz.nextRunAt
      ? `当前空闲，下次大约 ${formatTime(biz.nextRunAt)} 再同步`
      : '当前空闲，等待下次自动同步',
    detailText: biz.lastSuccessAt
      ? `最近一次成功：${formatTime(biz.lastSuccessAt)}`
      : null,
    // 空闲不画满格进度条，避免误以为任务跑完到 100%
    percent: null,
    doneCount: null,
    totalCount: null,
    countLabel: null,
  }
}

function buildAfterSalesTasks(
  enabled: boolean,
  ops: Awaited<ReturnType<typeof getAfterSalesOpsSummary>>,
): RuntimeTaskProgressItem[] {
  const pending = ops.totals.pending ?? 0
  const running = ops.totals.running ?? 0
  const retryWait = ops.totals.retry_wait ?? 0
  const done = ops.totals.done ?? 0
  const open = pending + running + retryWait
  const total = open + done
  const batchRunning = isAfterSalesBackfillMutexRunning() || running > 0
  const percent =
    total > 0 ? clampPercent((done / total) * 100) : enabled ? 100 : null

  let status: RuntimeTaskStatus
  let statusText: string
  let detailText: string | null

  if (!enabled) {
    status = open > 0 ? 'paused' : 'idle'
    statusText =
      open > 0
        ? `自动同步已关闭，售后补查暂停；还剩 ${open} 单待处理`
        : '自动同步已关闭，售后补查暂停'
    detailText = '打开自动同步后，会按每店最多 10 单批量继续查'
  } else if (batchRunning || open > 0) {
    status = batchRunning ? 'running' : 'waiting'
    statusText = batchRunning
      ? `正在补查售后：本批按店铺批量处理（每店最多 10 单）`
      : `排队等待补查：还有 ${open} 单`
    detailText = `已完成 ${done} 单 · 待处理 ${pending} · 进行中 ${running} · 稍后重试 ${retryWait}`
  } else {
    status = 'done'
    statusText = '售后补查暂无积压'
    detailText = done > 0 ? `历史已完成 ${done} 单` : null
  }

  const tasks: RuntimeTaskProgressItem[] = [
    {
      id: 'after_sales',
      kind: 'after_sales',
      title: '售后补查',
      status,
      statusText,
      detailText,
      percent:
        status === 'done'
          ? 100
          : total > 0
            ? percent
            : null,
      doneCount: done,
      totalCount: total > 0 ? total : null,
      countLabel: total > 0 ? `${done}/${total}` : null,
    },
  ]

  const shops = [...ops.byShop]
    .filter((s) => s.pending + s.running + s.retry_wait > 0)
    .sort(
      (a, b) =>
        b.pending + b.running + b.retry_wait - (a.pending + a.running + a.retry_wait),
    )
    .slice(0, 8)

  for (const s of shops) {
    const sOpen = s.pending + s.running + s.retry_wait
    const sTotal = sOpen + s.done
    const sPercent = sTotal > 0 ? clampPercent((s.done / sTotal) * 100) : null
    const name = s.platformName || s.liveAccountId
    let shopStatus: RuntimeTaskStatus = 'waiting'
    let shopText = `${name}：待处理 ${sOpen} 单`
    if (!enabled) {
      shopStatus = 'paused'
      shopText = `${name}：暂停中，待处理 ${sOpen} 单`
    } else if (s.circuitOpen) {
      shopStatus = 'waiting'
      shopText = `${name}：店铺暂缓请求（本地保护），待处理 ${sOpen} 单`
    } else if (s.running > 0 || (batchRunning && sOpen > 0)) {
      shopStatus = batchRunning && s.running === 0 ? 'waiting' : 'running'
      shopText =
        s.running > 0
          ? `${name}：正在查售后`
          : `${name}：排队中，待处理 ${sOpen} 单`
    }
    tasks.push({
      id: `after_sales_shop:${s.liveAccountId}`,
      kind: 'after_sales_shop',
      title: `售后补查 · ${name}`,
      status: shopStatus,
      statusText: shopText,
      detailText: s.recentError
        ? `最近提示：${String(s.recentError).slice(0, 120)}`
        : s.etaMinutes != null && s.etaMinutes > 0
          ? `按当前速度大约还要 ${s.etaMinutes} 分钟`
          : null,
      percent: sPercent,
      doneCount: s.done,
      totalCount: sTotal > 0 ? sTotal : null,
      countLabel: sTotal > 0 ? `${s.done}/${sTotal}` : null,
    })
  }

  return tasks
}

function buildBuyerRankingTask(
  buyer: Awaited<ReturnType<typeof getBusinessSyncStatus>>['buyerRankingSync'],
): RuntimeTaskProgressItem {
  if (buyer.status === 'running') {
    return {
      id: 'buyer_ranking',
      kind: 'buyer_ranking',
      title: '买家画像更新',
      status: 'running',
      statusText: '正在根据历史订单更新买家画像',
      detailText: buyer.message || null,
      percent: null,
      doneCount: null,
      totalCount: null,
      countLabel: null,
    }
  }
  if (buyer.status === 'failed') {
    return {
      id: 'buyer_ranking',
      kind: 'buyer_ranking',
      title: '买家画像更新',
      status: 'failed',
      statusText: '买家画像最近一次更新失败',
      detailText: buyer.lastError?.slice(0, 180) || buyer.message || null,
      percent: null,
      doneCount: null,
      totalCount: null,
      countLabel: null,
    }
  }
  return {
    id: 'buyer_ranking',
    kind: 'buyer_ranking',
    title: '买家画像更新',
    status: 'idle',
    statusText: '买家画像当前空闲',
    detailText: buyer.lastRunAt ? `最近更新：${formatTime(buyer.lastRunAt)}` : null,
    percent: null,
    doneCount: null,
    totalCount: null,
    countLabel: null,
  }
}

function buildHeadline(
  enabled: boolean,
  tasks: RuntimeTaskProgressItem[],
): string {
  const running = tasks.filter((t) => t.status === 'running')
  if (running.length > 0) {
    const titles = running
      .filter((t) => t.kind !== 'after_sales_shop')
      .map((t) => t.title)
    const uniq = [...new Set(titles)]
    const prefix = enabled ? '正在跑' : '自动同步已关，但仍在跑'
    return `${prefix}：${uniq.join('、')}`
  }
  if (!enabled) {
    const after = tasks.find((t) => t.id === 'after_sales')
    const openLabel =
      after?.totalCount != null && after.doneCount != null
        ? Math.max(0, after.totalCount - after.doneCount)
        : null
    return openLabel && openLabel > 0
      ? `自动同步已关闭：订单和售后都不会自动拉平台；售后还剩 ${openLabel} 单排队`
      : '自动同步已关闭：后台不会自动去小红书拉订单或售后'
  }
  return '后台现在比较空闲，没有正在跑的同步任务'
}

export async function getRuntimeProgressSnapshot(): Promise<RuntimeProgressSnapshot> {
  const [bizPack, sync, afterSales] = await Promise.all([
    getBusinessSyncStatus(),
    getSyncStatusPayload(),
    getAfterSalesOpsSummary(),
  ])

  const enabled = bizPack.businessSync.enabled === true
  const tasks: RuntimeTaskProgressItem[] = [
    buildBusinessSyncTask(enabled, bizPack.businessSync, sync),
    ...buildAfterSalesTasks(enabled, afterSales),
    buildBuyerRankingTask(bizPack.buyerRankingSync),
  ]

  const anyRunning = tasks.some((t) => t.status === 'running')

  return {
    polledAt: new Date().toISOString(),
    autoSyncEnabled: enabled,
    anyRunning,
    headline: buildHeadline(enabled, tasks),
    tasks,
  }
}
