/**
 * 经营同步 / 小红书远程接口 CMD 日志（老板视角，不含 Cookie/签名头）
 */
import { BUSINESS_SYNC_INTERVAL_MINUTES } from '../config/business-sync.constants'
import { logInfo, logWarn } from './server-log'

const SYNC_SCOPE = '经营同步'
const ORDER_SCOPE = '小红书订单'
const AFTER_SALE_SCOPE = '小红书售后'
const QUALITY_SCOPE = '官方品退'
const LIVE_SCOPE = '直播场次'
const XHS_SCOPE = '小红书接口'

export interface SyncAccountContext {
  accountName: string
  liveAccountId?: string
  accountIndex?: number
  accountTotal?: number
}

export interface AccountSyncSummaryLine {
  accountName: string
  liveAccountId?: string
  orders: number
  afterSales: number
  qualityCases: number
  liveSessions: number
  status: '成功' | '无新数据' | '失败' | '已跳过'
  failReason?: string
}

export function resolveSyncAccountDisplayName(
  name: string | undefined | null,
  index: number,
): string {
  const trimmed = name?.trim()
  if (trimmed && trimmed !== '未知直播号' && trimmed !== 'legacy') {
    return trimmed
  }
  return `直播号#${index}`
}

export function formatAccountLabel(ctx: SyncAccountContext): string {
  const idx = ctx.accountIndex ?? 1
  const name = resolveSyncAccountDisplayName(ctx.accountName, idx)
  const slot =
    ctx.accountIndex != null && ctx.accountTotal != null
      ? `（第 ${ctx.accountIndex}/${ctx.accountTotal} 个）`
      : ''
  return `${name}${slot}`
}

export function formatAccountListEntry(
  account: { name: string; id: string },
  index: number,
): string {
  const name = resolveSyncAccountDisplayName(account.name, index)
  return `${index}. ${name}（ID=${account.id}）`
}

export function logBusinessSyncNoAccounts(): void {
  logWarn(SYNC_SCOPE, '未发现已启用直播号，本轮跳过远程同步')
}

export function logBusinessSyncPrepare(params: {
  lookbackDays: number
  accounts: Array<{ name: string; id: string }>
}): void {
  const n = params.accounts.length
  logInfo(
    SYNC_SCOPE,
    `本轮准备同步最近 ${params.lookbackDays} 天数据，启用直播号 ${n} 个`,
  )
  if (n === 0) {
    logBusinessSyncNoAccounts()
    return
  }
  const list = params.accounts
    .map((a, i) => formatAccountListEntry(a, i + 1))
    .join('；')
  logInfo(SYNC_SCOPE, `账号列表：${list}`)
}

export function logBusinessSyncContinueNext(ctx: SyncAccountContext): void {
  logInfo(SYNC_SCOPE, `继续处理下一个账号：${formatAccountLabel(ctx)}`)
}

export function logBusinessSyncAccountSummary(lines: AccountSyncSummaryLine[]): void {
  logInfo(SYNC_SCOPE, '本轮账号同步汇总：')
  for (const line of lines) {
    const name = resolveSyncAccountDisplayName(line.accountName, 1)
    const detail = [
      `订单 ${line.orders} 条`,
      `售后 ${line.afterSales} 条`,
      `品退 ${line.qualityCases} 条`,
      `直播场次 ${line.liveSessions} 场`,
      `状态 ${line.status}`,
    ].join('，')
    const fail = line.failReason ? `（${line.failReason}）` : ''
    logInfo(SYNC_SCOPE, `${name}：${detail}${fail}`)
  }
}

export function logBusinessSyncRoundComplete(params: {
  accountTotal: number
  successCount: number
  failedCount: number
  durationSec: number
  extra?: string
}): void {
  const intervalHint = `下次同步约 ${BUSINESS_SYNC_INTERVAL_MINUTES} 分钟后`
  const base =
    `本轮远程同步完成：账号 ${params.accountTotal} 个，成功 ${params.successCount} 个，失败 ${params.failedCount} 个，用时 ${params.durationSec.toFixed(1)} 秒`
  const extra = params.extra ? `，${params.extra}` : ''
  logInfo(SYNC_SCOPE, `${base}${extra}，${intervalHint}`)
}

export function logBusinessSyncRoundStart(message: string): void {
  logInfo(SYNC_SCOPE, `本轮开始：${message}`)
}

export function logOrderSyncStart(ctx: SyncAccountContext, dateRange: string): void {
  logInfo(ORDER_SCOPE, `开始读取：${formatAccountLabel(ctx)}，范围 ${dateRange}`)
}

export function logOrderSyncPage(ctx: SyncAccountContext, pageNo: number): void {
  const name = resolveSyncAccountDisplayName(ctx.accountName, ctx.accountIndex ?? 1)
  logInfo(ORDER_SCOPE, `${name} 第 ${pageNo} 页读取中...`)
}

export function logOrderSyncPageResult(
  ctx: SyncAccountContext,
  pageNo: number,
  rowCount: number,
): void {
  const name = resolveSyncAccountDisplayName(ctx.accountName, ctx.accountIndex ?? 1)
  if (rowCount === 0 && pageNo > 1) {
    logInfo(ORDER_SCOPE, `${name} 第 ${pageNo} 页返回 0 条，订单读取结束`)
  } else {
    logInfo(ORDER_SCOPE, `${name} 第 ${pageNo} 页返回 ${rowCount} 条`)
  }
}

export function logOrderSyncComplete(params: {
  ctx: SyncAccountContext
  apiRows: number
  created: number
  updated: number
  skipped: number
  durationSec: number
}): void {
  const name = resolveSyncAccountDisplayName(params.ctx.accountName, params.ctx.accountIndex ?? 1)
  if (params.apiRows === 0) {
    logInfo(ORDER_SCOPE, `${name} 读取完成：接口返回 0 条，本账号本范围暂无订单`)
    return
  }
  logInfo(
    ORDER_SCOPE,
    `${name} 读取完成：接口返回 ${params.apiRows} 条，新增 ${params.created} 条，更新 ${params.updated} 条，跳过 ${params.skipped} 条，用时 ${params.durationSec.toFixed(1)} 秒`,
  )
}

export function logOrderSyncFailed(ctx: SyncAccountContext, reason: string): void {
  const name = resolveSyncAccountDisplayName(ctx.accountName, ctx.accountIndex ?? 1)
  logWarn(ORDER_SCOPE, `${name} 读取失败：${reason}，本账号已跳过`)
}

export function logLiveSyncStart(ctx: SyncAccountContext, dateRange: string): void {
  logInfo(LIVE_SCOPE, `开始读取：${formatAccountLabel(ctx)}，范围 ${dateRange}`)
}

export function logLiveSyncComplete(params: {
  ctx: SyncAccountContext
  apiRows: number
  saved: number
  durationSec: number
}): void {
  const name = resolveSyncAccountDisplayName(params.ctx.accountName, params.ctx.accountIndex ?? 1)
  if (params.apiRows === 0) {
    logInfo(LIVE_SCOPE, `${name} 读取完成：接口返回 0 场，本账号本范围暂无直播场次`)
    return
  }
  logInfo(
    LIVE_SCOPE,
    `${name} 读取完成：接口返回 ${params.apiRows} 场，保存 ${params.saved} 场，用时 ${params.durationSec.toFixed(1)} 秒`,
  )
}

export function logLiveSyncFailed(ctx: SyncAccountContext, reason: string): void {
  const name = resolveSyncAccountDisplayName(ctx.accountName, ctx.accountIndex ?? 1)
  logWarn(LIVE_SCOPE, `${name} 读取失败：${reason}，本账号已跳过`)
}

export function logAfterSaleSyncStart(ctx: SyncAccountContext, dateRange: string): void {
  logInfo(AFTER_SALE_SCOPE, `开始读取：${formatAccountLabel(ctx)}，范围 ${dateRange}`)
}

export function logAfterSaleSyncComplete(params: {
  ctx: SyncAccountContext
  apiRows: number
  matchedOrders: number
  unmatched: number
  durationSec?: number
}): void {
  const name = resolveSyncAccountDisplayName(params.ctx.accountName, params.ctx.accountIndex ?? 1)
  if (params.apiRows === 0) {
    logInfo(AFTER_SALE_SCOPE, `${name} 读取完成：接口返回 0 条，本账号本范围暂无售后`)
    return
  }
  const time =
    params.durationSec != null ? `，用时 ${params.durationSec.toFixed(1)} 秒` : ''
  logInfo(
    AFTER_SALE_SCOPE,
    `${name} 读取完成：接口返回 ${params.apiRows} 条，匹配订单 ${params.matchedOrders} 条，未匹配 ${params.unmatched} 条${time}`,
  )
}

export function logAfterSaleSyncFailed(ctx: SyncAccountContext, reason: string): void {
  const name = resolveSyncAccountDisplayName(ctx.accountName, ctx.accountIndex ?? 1)
  logWarn(AFTER_SALE_SCOPE, `${name} 读取失败：${reason}，本账号已跳过`)
}

export function logAfterSaleWorkbenchFetch(params: {
  ctx: SyncAccountContext
  orderNo: string
  status: '成功' | '无数据' | '失败'
  rowCount?: number
  reason?: string
}): void {
  const name = resolveSyncAccountDisplayName(params.ctx.accountName, params.ctx.accountIndex ?? 1)
  if (params.status === '失败') {
    logWarn(
      AFTER_SALE_SCOPE,
      `${name} 订单 ${params.orderNo} 售后工作台查询失败：${params.reason ?? '未知错误'}`,
    )
    return
  }
  if (params.status === '无数据') {
    logInfo(AFTER_SALE_SCOPE, `${name} 订单 ${params.orderNo} 售后工作台：暂无售后记录`)
    return
  }
  logInfo(
    AFTER_SALE_SCOPE,
    `${name} 订单 ${params.orderNo} 售后工作台：返回 ${params.rowCount ?? 0} 条`,
  )
}

export function logQualitySyncStart(ctx: SyncAccountContext, dateRange: string): void {
  logInfo(QUALITY_SCOPE, `开始读取：${formatAccountLabel(ctx)}，范围 ${dateRange}`)
}

export function logQualitySyncComplete(params: {
  ctx: SyncAccountContext
  apiRows: number
  matchedOrders: number
  saved: number
  durationSec?: number
}): void {
  const name = resolveSyncAccountDisplayName(params.ctx.accountName, params.ctx.accountIndex ?? 1)
  if (params.apiRows === 0) {
    logInfo(QUALITY_SCOPE, `${name} 读取完成：接口返回 0 条，本账号本范围暂无官方品退`)
    return
  }
  const time =
    params.durationSec != null ? `，用时 ${params.durationSec.toFixed(1)} 秒` : ''
  logInfo(
    QUALITY_SCOPE,
    `${name} 读取完成：接口返回 ${params.apiRows} 条，匹配订单 ${params.matchedOrders} 条，保存 ${params.saved} 条${time}`,
  )
}

export function logQualitySyncFailed(ctx: SyncAccountContext, reason: string): void {
  const name = resolveSyncAccountDisplayName(ctx.accountName, ctx.accountIndex ?? 1)
  logWarn(QUALITY_SCOPE, `${name} 读取失败：${reason}，本账号已跳过`)
}

export function logXhsAccountRateLimited(ctx: SyncAccountContext): void {
  const name = resolveSyncAccountDisplayName(ctx.accountName, ctx.accountIndex ?? 1)
  logWarn(XHS_SCOPE, `${name} 触发限流，已停止本账号后续远程请求，等待下轮同步`)
}

export function logXhsAccountAuthFailed(ctx: SyncAccountContext, httpStatus?: number): void {
  const name = resolveSyncAccountDisplayName(ctx.accountName, ctx.accountIndex ?? 1)
  const statusPart = httpStatus ? `（HTTP ${httpStatus}）` : ''
  logWarn(XHS_SCOPE, `${name} Cookie 可能失效或权限不足${statusPart}，本账号已跳过`)
}

export function logXhsApiQueryStart(params: {
  apiLabel: string
  accountName: string
  pageNo?: number
  dateRange?: string
}): void {
  const pagePart = params.pageNo != null ? `，页码=${params.pageNo}` : ''
  const rangePart = params.dateRange ? `，范围=${params.dateRange}` : ''
  logInfo(
    XHS_SCOPE,
    `正在查询${params.apiLabel}：账号=${params.accountName}${pagePart}${rangePart}`,
  )
}

export function logXhsApiQuerySuccess(message: string): void {
  logInfo(XHS_SCOPE, message)
}

export function logXhsSyncRoundStopped(): void {
  logWarn(
    XHS_SCOPE,
    'Cookie可能失效或触发限制，本轮同步已停止，等待下次周期或用户更新Cookie。',
  )
}

export function formatSyncDateRange(startDate: string, endDate: string): string {
  return `${startDate} 00:00:00 ~ ${endDate} 23:59:59`
}
