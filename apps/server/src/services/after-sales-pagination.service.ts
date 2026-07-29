/**
 * 售后详情分页终止规则（纯函数）
 */
export function parseFiniteNonNegativeInt(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || n < 0) return null
  return Math.floor(n)
}

export type PaginationContinueDecision =
  | { action: 'complete' }
  | { action: 'continue' }
  | {
      action: 'fail'
      code:
        | 'PAGINATION_INCOMPLETE'
        | 'PAGINATION_INCOMPLETE_SHORT_PAGE'
        | 'PAGINATION_INCOMPLETE_EMPTY_PAGE'
        | 'PAGINATION_INCOMPLETE_TOTAL_UNKNOWN'
        | 'PAGINATION_STALLED'
      message: string
    }

export function decideAfterSalesPagination(params: {
  page: number
  pageSize: number
  pageRowsLength: number
  totalCount: number | null
  rawFetchedCount: number
  uniqueFetchedCount: number
  pageHardLimit: number
  pageFingerprint: string
  seenFingerprints: Set<string>
}): PaginationContinueDecision {
  const {
    page,
    pageSize,
    pageRowsLength,
    totalCount,
    rawFetchedCount,
    uniqueFetchedCount,
    pageHardLimit,
    pageFingerprint,
    seenFingerprints,
  } = params

  if (pageRowsLength > 0) {
    if (seenFingerprints.has(pageFingerprint)) {
      return {
        action: 'fail',
        code: 'PAGINATION_STALLED',
        message: `PAGINATION_STALLED page=${page} total=${totalCount ?? 'null'} raw=${rawFetchedCount} unique=${uniqueFetchedCount}`,
      }
    }
  }

  if (totalCount != null) {
    if (rawFetchedCount >= totalCount || uniqueFetchedCount >= totalCount) {
      return { action: 'complete' }
    }
    if (pageRowsLength === 0) {
      return {
        action: 'fail',
        code: 'PAGINATION_INCOMPLETE_EMPTY_PAGE',
        message: `PAGINATION_INCOMPLETE_EMPTY_PAGE total=${totalCount} raw=${rawFetchedCount} unique=${uniqueFetchedCount} page=${page}`,
      }
    }
    if (pageRowsLength < pageSize) {
      return {
        action: 'fail',
        code: 'PAGINATION_INCOMPLETE_SHORT_PAGE',
        message: `PAGINATION_INCOMPLETE_SHORT_PAGE total=${totalCount} raw=${rawFetchedCount} unique=${uniqueFetchedCount} page=${page} pageSize=${pageSize}`,
      }
    }
    if (page >= pageHardLimit) {
      return {
        action: 'fail',
        code: 'PAGINATION_INCOMPLETE',
        message: `PAGINATION_INCOMPLETE total=${totalCount} raw=${rawFetchedCount} unique=${uniqueFetchedCount} page=${page}`,
      }
    }
    return { action: 'continue' }
  }

  // total 未知
  if (pageRowsLength === 0) return { action: 'complete' }
  if (pageRowsLength < pageSize) return { action: 'complete' }
  if (page >= pageHardLimit) {
    return {
      action: 'fail',
      code: 'PAGINATION_INCOMPLETE_TOTAL_UNKNOWN',
      message: `PAGINATION_INCOMPLETE_TOTAL_UNKNOWN raw=${rawFetchedCount} unique=${uniqueFetchedCount} page=${page}`,
    }
  }
  return { action: 'continue' }
}
