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

/** 售后进度「本轮」状态：用进程内快照，避免历史 done/累计分母导致新入队时百分比回退 */
type AfterSalesWaveProgressState = {
  startDone: number
  lastPercent: number
}

function getAfterSalesWaveStateBag(): { current: AfterSalesWaveProgressState | null } {
  const g = globalThis as {
    __afterSalesWaveProgress?: { current: AfterSalesWaveProgressState | null }
  }
  if (!g.__afterSalesWaveProgress) g.__afterSalesWaveProgress = { current: null }
  return g.__afterSalesWaveProgress
}

/** 测试用：清空本轮进度快照 */
export function resetAfterSalesWaveProgressForTests(): void {
  getAfterSalesWaveStateBag().current = null
}

/**
 * 本轮进度 = 本轮已查 / (本轮已查 + 还剩)；展示百分比只增不减。
 * 新单入队会拉低「瞬时比例」，但不允许进度条回退。
 */
export function resolveAfterSalesWaveProgress(input: {
  done: number
  open: number
  prev: AfterSalesWaveProgressState | null
}): {
  next: AfterSalesWaveProgressState | null
  percent: number | null
  waveDone: number
  waveTotal: number | null
  countLabel: string | null
} {
  const done = Math.max(0, Math.floor(Number(input.done) || 0))
  const open = Math.max(0, Math.floor(Number(input.open) || 0))
  if (open <= 0) {
    return {
      next: null,
      percent: null,
      waveDone: 0,
      waveTotal: null,
      countLabel: null,
    }
  }

  const prev = input.prev
  const startDone = prev != null && done >= prev.startDone ? prev.startDone : done
  const waveDone = Math.max(0, done - startDone)
  const waveTotal = waveDone + open
  const raw = waveTotal > 0 ? clampPercent((waveDone / waveTotal) * 100) : 0
  const percent = Math.max(prev?.lastPercent ?? 0, raw)

  return {
    next: { startDone, lastPercent: percent },
    percent,
    waveDone,
    waveTotal,
    countLabel: `本轮已查 ${waveDone} · 还剩 ${open}`,
  }
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
  const failed = ops.totals.failed ?? 0
  const blocked = ops.totals.blocked ?? 0
  const open = pending + running + retryWait
  const incomplete = failed + blocked
  const batchRunning = isAfterSalesBackfillMutexRunning() || running > 0
  const lastSuccessAt = ops.byShop
    .map((s) => s.lastSuccessAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1) ?? null

  const waveBox = getAfterSalesWaveStateBag()
  const wave = resolveAfterSalesWaveProgress({
    done,
    open,
    prev: waveBox.current,
  })
  waveBox.current = wave.next

  let status: RuntimeTaskStatus
  let statusText: string
  let detailText: string | null

  if (!enabled) {
    status = open > 0 || incomplete > 0 ? 'paused' : 'idle'
    statusText =
      open > 0
        ? `自动同步已关闭，售后补查暂停；还剩 ${open} 单待处理`
        : incomplete > 0
          ? `自动同步已关闭；另有失败 ${failed} 单、受阻 ${blocked} 单`
          : '自动同步已关闭，售后补查暂停'
    detailText = '打开自动同步后，会按每店最多 10 单批量继续查'
  } else if (batchRunning || open > 0) {
    status = batchRunning ? 'running' : 'waiting'
    statusText = batchRunning
      ? `正在补查售后：本批按店铺批量处理（每店最多 10 单）`
      : `排队等待补查：还有 ${open} 单（大约每分钟自动领一批）`
    const runningDetail = batchRunning
      ? `本轮已查 ${wave.waveDone} 单 · 待处理 ${pending} · 进行中 ${running} · 稍后重试 ${retryWait}`
      : `还剩 ${open} 单待领取；不是卡住，只是这会儿没有正在跑的批次`
    detailText =
      incomplete > 0
        ? `${runningDetail}；另有失败 ${failed} 单、受阻 ${blocked} 单`
        : runningDetail
  } else if (incomplete > 0) {
    // 无积压但仍有失败/受阻：不可标「已完成」满格，否则与看板完整性告警矛盾
    status = failed > 0 ? 'failed' : 'paused'
    statusText =
      failed > 0 && blocked > 0
        ? `售后补查有 ${failed} 单失败、${blocked} 单受阻，退款与签收可能不完整`
        : failed > 0
          ? `售后补查有 ${failed} 单失败，退款与签收可能不完整`
          : `售后补查有 ${blocked} 单受阻（Cookie/签名），退款与签收可能不完整`
    detailText =
      done > 0
        ? `历史已完成 ${done} 单；失败/受阻不会算作已清完`
        : '失败/受阻不会算作已清完'
  } else {
    // 与经营同步 / 买家画像一致：空闲不画满格进度条
    status = 'idle'
    statusText = '售后补查当前空闲'
    detailText = lastSuccessAt
      ? `最近成功：${formatTime(lastSuccessAt)}${done > 0 ? ` · 历史已完成 ${done} 单` : ''}`
      : done > 0
        ? `历史已完成 ${done} 单`
        : null
  }

  // 仅批次进行中画进度条；空闲/失败不画满格，避免误以为 100% 已全部正常
  const showWaveBar =
    status === 'running' || (status === 'waiting' && (wave.waveDone ?? 0) > 0)
  const displayPercent = showWaveBar ? wave.percent : null
  const displayCountLabel = showWaveBar
    ? wave.countLabel
    : open > 0
      ? `还剩 ${open}`
      : null

  const tasks: RuntimeTaskProgressItem[] = [
    {
      id: 'after_sales',
      kind: 'after_sales',
      title: '售后补查',
      status,
      statusText,
      detailText,
      percent: displayPercent,
      doneCount: open > 0 ? wave.waveDone : null,
      totalCount: open > 0 ? wave.waveTotal : null,
      countLabel: displayCountLabel,
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
    // 分店只展示积压数量，不画历史累计百分比（避免新入队时条往回缩）
    tasks.push({
      id: `after_sales_shop:${s.liveAccountId}`,
      kind: 'after_sales_shop',
      title: `售后补查 · ${name}`,
      status: shopStatus,
      statusText: shopText,
      detailText: s.recentError
        ? `最近提示：${String(s.recentError).slice(0, 120)}`
        : s.running > 0 && s.etaMinutes != null && s.etaMinutes > 0
          ? `按当前批次速度粗估还要 ${s.etaMinutes} 分钟`
          : null,
      percent: null,
      doneCount: null,
      totalCount: sOpen,
      countLabel: `还剩 ${sOpen}`,
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
  const mainTasks = tasks.filter((t) => t.kind !== 'after_sales_shop')
  const running = mainTasks.filter((t) => t.status === 'running')
  if (running.length > 0) {
    const titles = running.map((t) => t.title)
    const uniq = [...new Set(titles)]
    const prefix = enabled ? '正在跑' : '自动同步已关，但仍在跑'
    return `${prefix}：${uniq.join('、')}`
  }
  const abnormal = mainTasks.filter((t) => t.status === 'failed' || t.status === 'paused')
  if (abnormal.length > 0 && enabled) {
    const titles = [...new Set(abnormal.map((t) => t.title))]
    return `后台暂无进行中的同步，但${titles.join('、')}仍有异常，看板退款/签收可能不完整`
  }
  if (!enabled) {
    const after = tasks.find((t) => t.id === 'after_sales')
    const openLeft =
      after?.totalCount != null
        ? Math.max(0, after.totalCount - (after.doneCount ?? 0))
        : null
    return openLeft && openLeft > 0
      ? `自动同步已关闭：订单和售后都不会自动拉平台；售后还剩 ${openLeft} 单排队`
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
