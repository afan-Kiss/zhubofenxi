import { getDecryptedCookieByAccountId } from './live-account.service'
import { requestXhsJson } from './xhs-http.service'
import { enqueueXhsRequest } from './xhs-api-sync/xhs-rate-limiter.service'
import {
  QUALITY_BAD_CASE_API,
  QUALITY_BAD_CASE_REFERER,
  QUALITY_DETAIL_PROBLEM_TYPE,
  QUALITY_DETAIL_TIME_WINDOW_CODE,
  QUALITY_SUMMARY_TIME_WINDOW_CODE,
} from './quality-badcase.types'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function unwrapData(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload)
  if (!root) return {}
  const data = asRecord(root.data)
  return data ?? root
}

export interface QualitySummaryItem {
  itemId: string
  itemName: string
  itemImage: string
  negativePayPkgCnt: number
  negativePayPkgRate: number
  negativeSellerPkgProportion: number
  negativeReasonList: string[]
  negativeReasonDetailList: Array<{ reason?: string; count?: number; solution?: string }>
}

export interface QualityDetailItem {
  packageId: string
  sourceBizId: string | null
  feedbackContent: string
  feedbackTime: string | null
  feedbackSource: string
  packagePayTime: string | null
  negativeReasonList: string[]
  itemId: string
  raw: Record<string, unknown>
}

async function postQualityApi<T>(
  url: string,
  body: Record<string, unknown>,
  liveAccountId: string,
  accountName?: string,
): Promise<T> {
  return enqueueXhsRequest(async () => {
    const cookie = await getDecryptedCookieByAccountId(liveAccountId)
    return requestXhsJson<T>({
      method: 'POST',
      url,
      body,
      cookie,
      referer: QUALITY_BAD_CASE_REFERER,
      needSign: true,
      signLogContext: {
        tag: 'quality-badcase-sign',
        liveAccountId,
        accountName,
      },
    })
  })
}

export async function fetchQualitySummaryPage(params: {
  pageNo: number
  pageSize: number
  liveAccountId: string
  accountName?: string
}): Promise<{ count: number; items: QualitySummaryItem[] }> {
  const payload = await postQualityApi<unknown>(
    QUALITY_BAD_CASE_API.summaryList,
    {
      pageNo: params.pageNo,
      pageSize: params.pageSize,
      negativePayPkgCntAsc: 0,
      rectifySearch: 0,
      controlFlowSearch: 0,
      timeWindowCode: QUALITY_SUMMARY_TIME_WINDOW_CODE,
    },
    params.liveAccountId,
    params.accountName,
  )
  const data = unwrapData(payload)
  const count = Number(data.count ?? 0)
  const list = Array.isArray(data.badCaseList) ? data.badCaseList : []
  const items: QualitySummaryItem[] = []
  for (const row of list) {
    const rec = asRecord(row)
    if (!rec) continue
    const itemId = String(rec.itemId ?? '').trim()
    if (!itemId) continue
    items.push({
      itemId,
      itemName: String(rec.itemName ?? '').trim(),
      itemImage: String(rec.itemImage ?? '').trim(),
      negativePayPkgCnt: Number(rec.negativePayPkgCnt ?? 0),
      negativePayPkgRate: Number(rec.negativePayPkgRate ?? 0),
      negativeSellerPkgProportion: Number(rec.negativeSellerPkgProportion ?? 0),
      negativeReasonList: Array.isArray(rec.negativeReasonList)
        ? rec.negativeReasonList.map((x) => String(x))
        : [],
      negativeReasonDetailList: Array.isArray(rec.negativeReasonDetailList)
        ? rec.negativeReasonDetailList
            .map((x) => asRecord(x))
            .filter((x): x is Record<string, unknown> => Boolean(x))
            .map((x) => ({
              reason: x.reason != null ? String(x.reason) : undefined,
              count: x.count != null ? Number(x.count) : undefined,
              solution: x.solution != null ? String(x.solution) : undefined,
            }))
        : [],
    })
  }
  return { count, items }
}

export async function fetchQualityDetailPage(params: {
  itemId: string
  pageNo: number
  pageSize: number
  liveAccountId: string
  accountName?: string
}): Promise<{ count: number; items: QualityDetailItem[] }> {
  const payload = await postQualityApi<unknown>(
    QUALITY_BAD_CASE_API.itemDetail,
    {
      itemId: params.itemId,
      timeWindowCode: QUALITY_DETAIL_TIME_WINDOW_CODE,
      pageNo: params.pageNo,
      pageSize: params.pageSize,
      problemType: QUALITY_DETAIL_PROBLEM_TYPE,
    },
    params.liveAccountId,
    params.accountName,
  )
  const data = unwrapData(payload)
  const count = Number(data.count ?? 0)
  const list = Array.isArray(data.badCaseList) ? data.badCaseList : []
  const items: QualityDetailItem[] = []
  for (const row of list) {
    const rec = asRecord(row)
    if (!rec) continue
    const packageId = String(rec.packageId ?? '').trim()
    if (!packageId) continue
    const feedback = asRecord(rec.userFeedbackBaseInfo) ?? {}
    const negativeReasonList = Array.isArray(rec.negativeReasonList)
      ? rec.negativeReasonList.map((x) => String(x))
      : []
    items.push({
      packageId,
      sourceBizId: feedback.sourceBizId != null ? String(feedback.sourceBizId).trim() : null,
      feedbackContent: String(feedback.feedbackContent ?? '').trim(),
      feedbackTime: feedback.feedbackTime != null ? String(feedback.feedbackTime).trim() : null,
      feedbackSource: String(feedback.source ?? '').trim(),
      packagePayTime:
        feedback.packagePayTime != null ? String(feedback.packagePayTime).trim() : null,
      negativeReasonList,
      itemId: params.itemId,
      raw: rec,
    })
  }
  return { count, items }
}

export async function fetchQualityItemIndexDetail(
  itemId: string,
  liveAccountId: string,
  accountName?: string,
): Promise<Record<string, unknown> | null> {
  const payload = await postQualityApi<unknown>(
    QUALITY_BAD_CASE_API.itemIndex,
    {
      itemId,
      timeWindowCode: QUALITY_DETAIL_TIME_WINDOW_CODE,
    },
    liveAccountId,
    accountName,
  )
  const data = unwrapData(payload)
  const index = asRecord(data.itemIndexDetail)
  return index
}
