export type AnchorLeaderboardRow = Record<string, unknown>

export function anchorRowNum(row: AnchorLeaderboardRow, key: string): number {
  return Number(row[key] ?? 0)
}

export function anchorRowRate(row: AnchorLeaderboardRow, key: string): number | null {
  const v = row[key]
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function anchorRowGmv(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'gmv') || anchorRowNum(row, 'totalGmv')
}

export function anchorRowValidSales(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'validSalesAmount') || anchorRowNum(row, 'effectiveGmv')
}

export function anchorRowSignedCount(row: AnchorLeaderboardRow): number {
  return (
    anchorRowNum(row, 'actualSignedCount') ||
    anchorRowNum(row, 'signedOrderCount') ||
    anchorRowNum(row, 'signedCount')
  )
}

export function anchorRowPaidCount(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'paidOrderCount') || anchorRowNum(row, 'orderCount')
}

export function anchorRowRefundAmount(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'returnAmount') || anchorRowNum(row, 'refundAmount')
}

export function anchorRowReturnRefundCount(row: AnchorLeaderboardRow): number {
  return anchorRowNum(row, 'returnRefundCount')
}

export function anchorRowReturnRefundRate(row: AnchorLeaderboardRow): number | null {
  return anchorRowRate(row, 'returnRefundRate')
}

export function isHighRefundRate(rate: number | null): boolean {
  return rate != null && rate >= 0.5
}
