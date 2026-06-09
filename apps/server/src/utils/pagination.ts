export interface PaginatedResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  summary?: Record<string, unknown>
}

export function clampPagination(page?: number, pageSize?: number) {
  const p = Number(page ?? 1)
  const ps = Number(pageSize ?? 20)
  const safePage = Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1
  const safeSize = Number.isFinite(ps) && ps >= 1 ? Math.min(100, Math.floor(ps)) : 20
  return { page: safePage, pageSize: safeSize }
}

export function paginateSlice<T>(list: T[], page: number, pageSize: number) {
  const total = list.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  return {
    items: list.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  }
}

export function paginatedResponse<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
  summary?: Record<string, unknown>,
): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    summary: summary ?? {},
  }
}
