/** 分页读取结束判断：不以 API total 作为唯一停止条件 */

export const SAFE_MAX_PAGES = 1000

export interface PageFetchResult<T> {
  rows: T[]
  totalEstimate?: number
  hasMore?: boolean
}

export function shouldStopPagination(params: {
  rowsThisPage: number
  pageSize: number
  pageNo: number
  hasMore?: boolean
  noMore?: boolean
  totalEstimate?: number
  accumulatedRows?: number
}): boolean {
  if (params.rowsThisPage === 0) return true
  const total = params.totalEstimate ?? 0
  const accumulated = params.accumulatedRows ?? 0
  // 有 total_count 时必须拉满，不能因 hasMore=false 或末页不满而提前结束
  if (total > 0) {
    if (accumulated >= total) return true
    return false
  }
  if (params.rowsThisPage < params.pageSize) return true
  if (params.hasMore === false) return true
  if (params.noMore === true) return true
  return false
}

/** 通用分页拉全：有 total_count 时拉至累计 >= total，否则拉至空页 */
export async function fetchAllPages<T>(params: {
  pageSize: number
  maxPages?: number
  fetchPage: (page: number) => Promise<{
    rows: T[]
    totalEstimate?: number
    hasMore?: boolean
    noMore?: boolean
    error?: string
  }>
  dedupeKey?: (row: T) => string
}): Promise<{ rows: T[]; pageCount: number; totalEstimate: number; warnings: string[] }> {
  const warnings: string[] = []
  const maxPages = params.maxPages ?? SAFE_MAX_PAGES
  const pageSize = params.pageSize
  const seen = new Set<string>()
  const all: T[] = []
  let page = 1
  let pageCount = 0
  let totalEstimate = 0

  while (page <= maxPages) {
    const result = await params.fetchPage(page)
    if (result.error) {
      warnings.push(result.error)
      break
    }
    pageCount++
    if (result.totalEstimate && result.totalEstimate > totalEstimate) {
      totalEstimate = result.totalEstimate
    }
    for (const row of result.rows) {
      const key = params.dedupeKey?.(row) ?? String(all.length)
      if (seen.has(key)) continue
      seen.add(key)
      all.push(row)
    }
    if (
      shouldStopPagination({
        rowsThisPage: result.rows.length,
        pageSize,
        pageNo: page,
        hasMore: result.hasMore,
        noMore: result.noMore,
        totalEstimate,
        accumulatedRows: all.length,
      })
    ) {
      break
    }
    page++
  }

  if (page > maxPages) {
    warnings.push(`已达到最大页数保护 ${maxPages}，可能未拉取完整`)
  }
  if (totalEstimate > 0 && all.length < totalEstimate) {
    warnings.push(`分页累计 ${all.length} 条，少于 total_count ${totalEstimate}`)
  }

  return { rows: all, pageCount, totalEstimate, warnings }
}

export function extractApiTotal(data: unknown): number {
  if (!data || typeof data !== 'object') return 0
  const root = data as Record<string, unknown>
  const inner =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root
  const total = inner.total ?? inner.totalCount ?? inner.total_count
  return typeof total === 'number' && total > 0 ? total : 0
}

export function extractApiHasMore(data: unknown): boolean | undefined {
  if (!data || typeof data !== 'object') return undefined
  const root = data as Record<string, unknown>
  const inner =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root
  if (typeof inner.hasMore === 'boolean') return inner.hasMore
  if (typeof inner.has_more === 'boolean') return inner.has_more
  if (typeof inner.noMore === 'boolean') return !inner.noMore
  if (typeof inner.no_more === 'boolean') return !inner.no_more
  const next = inner.nextPage ?? inner.next_page
  if (next === null || next === '' || next === 0) return false
  return undefined
}
