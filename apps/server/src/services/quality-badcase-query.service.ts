import type { NormalizedQualityBadCase } from './quality-badcase.types'
import { matchStatusLabel } from './quality-badcase.types'
import { loadAllQualityBadCases } from './quality-badcase-store.service'

function parseDateMs(value: string | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value.length <= 10 ? `${value}T00:00:00` : value.replace(' ', 'T'))
  return Number.isFinite(t) ? t : null
}

function caseInRange(
  c: NormalizedQualityBadCase,
  startMs: number | null,
  endMs: number | null,
): boolean {
  if (startMs == null && endMs == null) return true
  const payMs = c.packagePayTime ? Date.parse(c.packagePayTime.replace(' ', 'T')) : NaN
  const fbMs = c.feedbackTime ? Date.parse(c.feedbackTime.replace(' ', 'T')) : NaN
  const ms = Number.isFinite(payMs) ? payMs : Number.isFinite(fbMs) ? fbMs : null
  if (ms == null) return true
  if (startMs != null && ms < startMs) return false
  if (endMs != null && ms > endMs + 86400000 - 1) return false
  return true
}

export async function queryQualityBadCases(params: {
  startDate?: string
  endDate?: string
  anchorId?: string
  buyerId?: string
  page?: number
  pageSize?: number
  sort?: string
  matchStatus?: string
  source?: string
}): Promise<{
  page: number
  pageSize: number
  total: number
  totalPages: number
  rows: Array<Record<string, unknown>>
}> {
  const all = await loadAllQualityBadCases()
  const startMs = parseDateMs(params.startDate)
  const endMs = parseDateMs(params.endDate)
  let list = all.filter((c) => caseInRange(c, startMs, endMs))
  if (params.anchorId?.trim()) {
    const aid = params.anchorId.trim()
    list = list.filter((c) => c.matchedAnchorId === aid || c.matchedAnchorName === aid)
  }
  if (params.buyerId?.trim()) {
    const bid = params.buyerId.trim()
    list = list.filter((c) => c.matchedBuyerId === bid)
  }
  if (params.matchStatus?.trim()) {
    list = list.filter((c) => c.matchStatus === params.matchStatus)
  }
  if (params.sort === 'time_desc') {
    list.sort((a, b) => String(b.feedbackTime ?? '').localeCompare(String(a.feedbackTime ?? '')))
  } else {
    list.sort((a, b) => String(b.packagePayTime ?? '').localeCompare(String(a.packagePayTime ?? '')))
  }

  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))
  const total = list.length
  const slice = list.slice((page - 1) * pageSize, page * pageSize)

  const rows = slice.map((c) => ({
    orderNo: c.matchedOrderNo || c.packageId,
    packageId: c.packageId,
    productName: c.itemName,
    buyerNickname: c.matchedBuyerNickname || '—',
    buyerId: c.matchedBuyerId || '—',
    payTime: c.packagePayTime,
    qualityFeedbackTime: c.feedbackTime,
    officialQualityReason: c.negativeReasons.join('、') || '—',
    feedbackContent: c.feedbackContent || '—',
    afterSaleNo: c.sourceBizId || c.matchedAfterSaleId || '—',
    afterSaleStatus: c.afterSaleStatus || '—',
    afterSaleReason: c.afterSaleReason || '—',
    refundAmount: c.afterSaleRefundAmount,
    matchStatus: matchStatusLabel(c.matchStatus),
    anchorName: c.matchedAnchorName || '未归属',
    anchorId: c.matchedAnchorId || '—',
    source: c.source,
    isOfficialQualityBadCase: true,
  }))

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows,
  }
}
