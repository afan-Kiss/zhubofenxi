/**
 * 线下成交台账：事实来源表 OfflineDeal。
 * 有效 confirmed 成交按支付金额口径计入总 GMV / 主播 GMV；
 * 不参与场次、排班、时段自动匹配；归属仅人工。
 */
import { prisma } from '../lib/prisma'
import type { AnalyzedOrderView } from '../types/analysis'
import { getAnchorConfigSync, refreshAnchorConfigCache, findYifanManualSystemAnchor } from './anchor.service'
import { findAnchorByName } from './anchor-rules.service'
import { invalidateAndRebuildBusinessBoardCache } from './business-cache.service'
import { clearScheduleAttributionCache } from './anchor-schedule-attribution.service'
import { clearCanonicalAttributionCache } from './canonical-order-attribution.service'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { logInfo } from '../utils/server-log'
import {
  isOfflineDealAtEffectiveForGmv,
  OFFLINE_GMV_EFFECTIVE_FROM_DATE,
} from '../config/offline-gmv.constants'

export type OfflineDealStatus = 'draft' | 'confirmed' | 'cancelled' | 'voided'

const VALID_STATUSES = new Set<OfflineDealStatus>([
  'draft',
  'confirmed',
  'cancelled',
  'voided',
])

export function isOfflineDealView(
  view: AnalyzedOrderView & {
    raw?: Record<string, unknown>
    scheduleAttributionSource?: string | null
  },
): boolean {
  if (view.sourceType === 'offline_deal' || view.dealSource === 'offline') return true
  if (view.offlineDealKey) return true
  if (view.scheduleAttributionSource === 'offline_manual') return true
  const raw = view.raw
  if (raw && (raw.dealSource === 'offline' || raw.sourceType === 'offline_deal')) return true
  const orderNo = String(
    view.displayOrderNo || view.officialOrderNo || view.packageId || view.orderId || '',
  ).trim()
  if (/^OFF-/i.test(orderNo)) return true
  if (/^offline:/i.test(orderNo)) return true
  return false
}

function yuanToCent(amountYuan: number): number {
  return Math.round(amountYuan * 100)
}

function centToYuan(cent: number): number {
  return Math.round(cent) / 100
}

function assertStatus(status: string): OfflineDealStatus {
  if (!VALID_STATUSES.has(status as OfflineDealStatus)) {
    throw new Error('成交状态无效（draft/confirmed/cancelled/voided）')
  }
  return status as OfflineDealStatus
}

function generateDealKey(dealAt: Date): string {
  const day = formatDateKeyShanghai(dealAt).replace(/-/g, '')
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `OFF-${day}-${rand}`
}

async function assertExternalKeyAvailable(externalKey: string | null | undefined, excludeId?: string) {
  const key = externalKey?.trim() || ''
  if (!key) return null
  const existing = await prisma.offlineDeal.findFirst({
    where: {
      externalKey: key,
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, dealKey: true },
  })
  if (existing) {
    throw new Error(`外部成交编号已存在：${key}（${existing.dealKey}）`)
  }
  // 与线上 P 单去重：禁止拿已存在的平台订单号当线下编号
  if (/^P/i.test(key)) {
    const online = await prisma.xhsRawOrder.findFirst({
      where: {
        OR: [{ orderId: key }, { packageId: key }],
      },
      select: { orderId: true },
    })
    if (online) {
      throw new Error(`「${key}」已是平台订单号，请勿作为线下成交编号重复录入`)
    }
  }
  return key
}

function resolveAnchorInput(input: {
  anchorId?: string | null
  anchorName?: string | null
}): { anchorId: string | null; anchorName: string | null } {
  const config = getAnchorConfigSync()
  const id = input.anchorId?.trim() || ''
  const name = input.anchorName?.trim() || ''
  if (!id && !name) return { anchorId: null, anchorName: null }
  if (name === '未归属') return { anchorId: null, anchorName: null }
  const byId = id ? config.anchors.find((a) => a.id === id && a.enabled) : undefined
  if (byId) return { anchorId: byId.id, anchorName: byId.name }
  const byName = name ? findAnchorByName(config, name) : undefined
  if (byName && byName.enabled) return { anchorId: byName.id, anchorName: byName.name }
  throw new Error(`主播「${name || id}」不存在或未启用`)
}

async function writeAudit(params: {
  dealId: string
  dealKey: string
  action: string
  before?: unknown
  after?: unknown
  beforeAnchorId?: string | null
  afterAnchorId?: string | null
  operator?: string | null
  reason?: string | null
}) {
  await prisma.offlineDealAuditLog.create({
    data: {
      dealId: params.dealId,
      dealKey: params.dealKey,
      action: params.action,
      beforeJson: params.before ? JSON.stringify(params.before) : null,
      afterJson: params.after ? JSON.stringify(params.after) : null,
      beforeAnchorId: params.beforeAnchorId ?? null,
      afterAnchorId: params.afterAnchorId ?? null,
      operator: params.operator ?? null,
      reason: params.reason ?? null,
    },
  })
}

function invalidateAfterWrite(reason: string) {
  clearScheduleAttributionCache()
  clearCanonicalAttributionCache()
  if (process.env.OFFLINE_DEAL_SKIP_CACHE_INVALIDATE === '1') return
  void invalidateAndRebuildBusinessBoardCache(reason).catch((e) => {
    logInfo(
      '线下成交',
      `缓存重建异常（下次访问将重建）：${e instanceof Error ? e.message : String(e)}`,
    )
  })
}

/**
 * 有效计入支付金额 / 线下 GMV：
 * 已确认、未软删、金额>0，且 dealAt >= 2026-07-14 00:00:00+08（不得用 createdAt）。
 */
export function offlineDealCountsInPayGmv(deal: {
  status: string
  amountCent: number
  deletedAt?: Date | null
  dealAt?: Date | number | string | null
}): boolean {
  if (deal.status !== 'confirmed' || deal.amountCent <= 0 || deal.deletedAt) return false
  return isOfflineDealAtEffectiveForGmv(deal.dealAt ?? null)
}

/** 台账可保留审计，但明确标记不计入业绩（含生效日前） */
export function offlineDealExcludedFromBusinessReason(deal: {
  status: string
  amountCent: number
  deletedAt?: Date | null
  dealAt?: Date | number | string | null
}): string | null {
  if (deal.deletedAt) return '线下成交已删除'
  if (deal.status === 'draft') return '线下成交草稿'
  if (deal.status === 'cancelled') return '线下成交已取消'
  if (deal.status === 'voided') return '线下成交已作废'
  if (deal.amountCent <= 0) return '线下成交金额无效'
  if (!isOfflineDealAtEffectiveForGmv(deal.dealAt ?? null)) {
    return `不计入业绩（成交日早于 ${OFFLINE_GMV_EFFECTIVE_FROM_DATE}）`
  }
  return null
}

/** 净 GMV 可用金额（支付 − 退款，下限 0） */
export function offlineDealNetCent(deal: { amountCent: number; refundCent: number }): number {
  return Math.max(0, deal.amountCent - Math.max(0, deal.refundCent))
}

export function offlineDealToAnalyzedView(deal: {
  id: string
  dealKey: string
  externalKey?: string | null
  amountCent: number
  refundCent: number
  dealAt: Date
  status: string
  anchorId?: string | null
  anchorName?: string | null
  customerLabel?: string | null
  note?: string | null
  createdBy?: string | null
  updatedBy?: string | null
  updatedAt?: Date
  deletedAt?: Date | null
}): AnalyzedOrderView {
  const included = offlineDealCountsInPayGmv(deal)
  const excludeReason = offlineDealExcludedFromBusinessReason(deal)
  const hasAnchor = Boolean(
    deal.anchorId?.trim() ||
      (deal.anchorName?.trim() && deal.anchorName.trim() !== '未归属'),
  )
  const anchorName = hasAnchor ? String(deal.anchorName).trim() : '未归属'
  const anchorId = hasAnchor ? String(deal.anchorId ?? '').trim() || `extra-${anchorName}` : ''
  const dealAtText = deal.dealAt.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  })
  const statusText =
    deal.status === 'confirmed'
      ? '已确认'
      : deal.status === 'draft'
        ? '草稿'
        : deal.status === 'cancelled'
          ? '已取消'
          : deal.status === 'voided'
            ? '已作废'
            : deal.status
  const refundCent = Math.max(0, deal.refundCent)
  const netCent = offlineDealNetCent(deal)
  const offlineDealNote = deal.note?.trim() || ''

  // 计入 GMV 且未全额退款 → 视为已签收（线下无物流签收态，用有效签收金额口径）
  const signed = included && refundCent < deal.amountCent
  return {
    orderId: deal.dealKey,
    packageId: deal.dealKey,
    bizOrderId: deal.externalKey?.trim() || deal.dealKey,
    displayOrderNo: deal.dealKey,
    officialOrderNo: deal.dealKey,
    matchOrderId: deal.dealKey,
    orderTimeText: dealAtText,
    buyerId: deal.customerLabel?.trim() || `offline:${deal.dealKey}`,
    anchorId,
    anchorName,
    liveAccountId: '',
    liveAccountName: '',
    attributionType: hasAnchor ? 'order_anchor_field' : 'unassigned',
    gmvCent: deal.amountCent,
    productAmountCent: deal.amountCent,
    receivableAmountCent: deal.amountCent,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: deal.amountCent,
    actualSellerReceiveAmountCent: deal.amountCent,
    actualSignedAmountCent: netCent,
    actualSignAmountCent: signed ? netCent : 0,
    orderStatusText: statusText,
    afterSaleStatusText: refundCent > 0 ? '线下退款' : '—',
    isSigned: signed,
    isReturned: refundCent > 0,
    isActualSigned: signed,
    isEffectiveSigned: signed,
    statusSigned: signed,
    isQualityReturn: false,
    returnAmountCent: refundCent,
    productRefundAmountCent: refundCent,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: refundCent,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isRealProductRefund: refundCent > 0,
    afterSaleCategory: refundCent > 0 ? 'offline_refund' : 'none',
    afterSaleStatusLabel: refundCent > 0 ? '线下退款' : '—',
    afterSaleDisplayType: refundCent > 0 ? '线下退款' : '—',
    isSizeMismatch: false,
    // 线下备注不得流入售后/品退原因链路
    reasonText: '',
    finalAfterSaleReason: '',
    afterSalesWorkbenchReason: '',
    offlineDealNote,
    effectiveGmvCent: included ? netCent : 0,
    paymentBaseCent: included ? deal.amountCent : 0,
    paymentBaseSource: 'offline_deal',
    includedInGmv: included,
    countsForSigned: signed,
    countsForGrossProfit: false,
    gmvExcludeReason: included ? null : excludeReason ?? '线下成交未计入',
    dealSource: 'offline',
    offlineDealKey: deal.dealKey,
    sourceType: 'offline_deal',
    statPaidAmountCent: included ? deal.amountCent : 0,
    successfulRefundAmountCent: refundCent,
    buyerNickname: deal.customerLabel ?? undefined,
    buyerDisplayName: deal.customerLabel ?? undefined,
    scheduleAttributionSource: hasAnchor ? 'offline_manual' : 'unassigned',
    scheduleAttributionExplain: hasAnchor
      ? `线下成交手动归属：${anchorName}`
      : '线下成交待归属主播',
    raw: {
      dealSource: 'offline',
      sourceType: 'offline_deal',
      offlineDealId: deal.id,
      offlineDealKey: deal.dealKey,
      externalKey: deal.externalKey,
      status: deal.status,
      createdBy: deal.createdBy,
      updatedBy: deal.updatedBy,
      attributedBy: deal.updatedBy ?? deal.createdBy,
      attributedAt: deal.updatedAt?.toISOString?.() ?? null,
      note: deal.note,
      offlineDealNote,
      refundCent,
      createTime: deal.dealAt.toISOString(),
      payTime: deal.dealAt.toISOString(),
      orderCreateTime: deal.dealAt.toISOString(),
    },
  } as AnalyzedOrderView & { raw: Record<string, unknown> }
}

export async function loadOfflineDealViewsForRange(
  startDate: string,
  endDate: string,
): Promise<AnalyzedOrderView[]> {
  const start = new Date(`${startDate}T00:00:00.000+08:00`)
  const end = new Date(`${endDate}T23:59:59.999+08:00`)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return []

  const rows = await prisma.offlineDeal.findMany({
    where: {
      deletedAt: null,
      dealAt: { gte: start, lte: end },
      status: { in: ['confirmed', 'draft', 'cancelled', 'voided'] },
    },
    orderBy: { dealAt: 'asc' },
  })
  return rows.map(offlineDealToAnalyzedView)
}

export function splitGmvByDealSource(views: AnalyzedOrderView[]): {
  onlineGmv: number
  offlineGmv: number
  unassignedGmv: number
  offlineDealCount: number
} {
  let onlineCent = 0
  let offlineCent = 0
  let unassignedCent = 0
  let offlineDealCount = 0
  for (const v of views) {
    if (!v.includedInGmv) continue
    const cent = v.paymentBaseCent ?? 0
    const offline = isOfflineDealView(v)
    if (offline) {
      offlineCent += cent
      offlineDealCount += 1
    } else {
      onlineCent += cent
    }
    const name = v.anchorName?.trim() || '未归属'
    if (!name || name === '未归属') unassignedCent += cent
  }
  return {
    onlineGmv: centToYuan(onlineCent),
    offlineGmv: centToYuan(offlineCent),
    unassignedGmv: centToYuan(unassignedCent),
    offlineDealCount,
  }
}

export async function listOfflineDeals(params: {
  startDate?: string
  endDate?: string
  anchorName?: string
  status?: string
  pendingOnly?: boolean
  page?: number
  pageSize?: number
}) {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))
  const where: Record<string, unknown> = { deletedAt: null }
  if (params.startDate && params.endDate) {
    where.dealAt = {
      gte: new Date(`${params.startDate}T00:00:00.000+08:00`),
      lte: new Date(`${params.endDate}T23:59:59.999+08:00`),
    }
  }
  if (params.status) where.status = assertStatus(params.status)
  if (params.pendingOnly) {
    where.status = 'confirmed'
    where.OR = [{ anchorId: null }, { anchorName: null }, { anchorName: '' }, { anchorName: '未归属' }]
  } else if (params.anchorName?.trim() && params.anchorName !== '全部') {
    where.anchorName = params.anchorName.trim()
  }
  const [total, rows] = await Promise.all([
    prisma.offlineDeal.count({ where }),
    prisma.offlineDeal.findMany({
      where,
      orderBy: [{ dealAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return {
    items: rows.map((r) => ({
      ...r,
      amountYuan: centToYuan(r.amountCent),
      refundYuan: centToYuan(r.refundCent),
      netYuan: centToYuan(offlineDealNetCent(r)),
      pendingAttribution: !r.anchorId && (!r.anchorName || r.anchorName === '未归属'),
      dealSource: 'offline' as const,
    })),
    pagination: { page, pageSize, total },
  }
}

export async function createOfflineDeal(input: {
  amountYuan: number
  dealAt: string | Date
  anchorId?: string | null
  anchorName?: string | null
  customerLabel?: string | null
  note?: string | null
  externalKey?: string | null
  status?: string
  allowPending?: boolean
  operator?: string | null
  idempotencyKey?: string | null
}) {
  await refreshAnchorConfigCache()
  const yifan = findYifanManualSystemAnchor(getAnchorConfigSync())
  if (!yifan) throw new Error('系统线下主播未初始化（YIFAN_MANUAL）')
  // 线下成交固定归属逸凡，不允许改归其他主播
  const amountYuan = Number(input.amountYuan)
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    throw new Error('成交金额必须大于 0')
  }
  const amountCent = yuanToCent(amountYuan)
  const status = assertStatus(input.status ?? 'confirmed')
  const dealAt =
    input.dealAt instanceof Date ? input.dealAt : new Date(String(input.dealAt))
  if (!Number.isFinite(dealAt.getTime())) throw new Error('成交时间无效')

  const externalKey = await assertExternalKeyAvailable(
    input.idempotencyKey?.trim() || input.externalKey,
  )
  const anchor = { anchorId: yifan.id, anchorName: yifan.name }

  let dealKey = generateDealKey(dealAt)
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.offlineDeal.findUnique({ where: { dealKey } })
    if (!clash) break
    dealKey = generateDealKey(dealAt)
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.offlineDeal.create({
        data: {
          dealKey,
          externalKey,
          amountCent,
          refundCent: 0,
          dealAt,
          status,
          anchorId: anchor.anchorId,
          anchorName: anchor.anchorName,
          customerLabel: input.customerLabel?.trim() || null,
          note: input.note?.trim() || null,
          createdBy: input.operator ?? null,
          updatedBy: input.operator ?? null,
        },
      })
      await tx.offlineDealAuditLog.create({
        data: {
          dealId: row.id,
          dealKey: row.dealKey,
          action: 'create',
          afterJson: JSON.stringify(row),
          afterAnchorId: row.anchorId,
          operator: input.operator ?? null,
        },
      })
      return row
    })
    logInfo(
      '线下成交',
      `录入 ${created.dealKey} ¥${centToYuan(created.amountCent)} → ${created.anchorName ?? '待归属'}`,
    )
    await invalidateAfterWrite(`offline-deal-create:${created.dealKey}`)
    return {
      ...created,
      amountYuan: centToYuan(created.amountCent),
      pendingAttribution: !created.anchorId,
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      throw new Error('成交编号冲突，请重试（可能为重复提交）')
    }
    throw e
  }
}

export async function reassignOfflineDeal(_params: {
  dealId: string
  anchorId?: string | null
  anchorName?: string | null
  operator?: string | null
  reason?: string | null
}): Promise<never> {
  throw new Error('线下成交固定归属系统线下主播，不允许改归其他主播')
}

export async function updateOfflineDealStatus(params: {
  dealId: string
  status: string
  refundYuan?: number
  operator?: string | null
  reason?: string | null
}) {
  const existing = await prisma.offlineDeal.findFirst({
    where: { id: params.dealId, deletedAt: null },
  })
  if (!existing) throw new Error('线下成交不存在')
  const status = assertStatus(params.status)
  let refundCent = existing.refundCent
  if (params.refundYuan != null) {
    const r = Number(params.refundYuan)
    if (!Number.isFinite(r) || r < 0) throw new Error('退款金额无效')
    refundCent = yuanToCent(r)
    if (refundCent > existing.amountCent) throw new Error('退款金额不能大于成交金额')
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.offlineDeal.update({
      where: { id: existing.id },
      data: {
        status,
        refundCent,
        updatedBy: params.operator ?? null,
      },
    })
    await tx.offlineDealAuditLog.create({
      data: {
        dealId: row.id,
        dealKey: row.dealKey,
        action: 'update_status',
        beforeJson: JSON.stringify(existing),
        afterJson: JSON.stringify(row),
        beforeAnchorId: existing.anchorId,
        afterAnchorId: row.anchorId,
        operator: params.operator ?? null,
        reason: params.reason ?? null,
      },
    })
    return row
  })
  await invalidateAfterWrite(`offline-deal-status:${updated.dealKey}`)
  return { ...updated, amountYuan: centToYuan(updated.amountCent) }
}

export async function listOfflineDealAudit(dealId: string) {
  return prisma.offlineDealAuditLog.findMany({
    where: { dealId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

void writeAudit
