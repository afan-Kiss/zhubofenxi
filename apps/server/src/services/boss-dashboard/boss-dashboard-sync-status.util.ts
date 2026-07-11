export type ShopSyncResult = {
  shopKey: string
  fundSuccess: boolean
  fundPartial?: boolean
  fundSnapshotWritten?: boolean
  fundError?: string | null
  scoreSkipped: boolean
  scoreSaved: boolean
  scorePartial?: boolean
  scoreDate: string | null
  scoreReason?: string | null
  skippedFresh?: boolean
}

export function summarizeBossRun(shopResults: ShopSyncResult[]): {
  status: 'success' | 'partial_success' | 'failed' | 'skipped'
  errorSummary: string | null
  attemptedShopCount: number
  succeededShopCount: number
  partialShopCount: number
  failedShopCount: number
  skippedShopCount: number
  snapshotWrittenCount: number
  scoreSnapshotWrittenCount: number
} {
  const attemptedShopCount = shopResults.length
  let succeededShopCount = 0
  let partialShopCount = 0
  let failedShopCount = 0
  let skippedShopCount = 0
  let snapshotWrittenCount = 0
  let scoreSnapshotWrittenCount = 0
  const errors: string[] = []

  for (const r of shopResults) {
    const fundOk = r.fundSuccess
    const fundPartial = r.fundPartial === true
    const scoreOk = r.scoreSaved
    const scorePartial = r.scorePartial === true
    const allSkipped = r.skippedFresh === true

    if (r.fundSnapshotWritten) snapshotWrittenCount += 1
    if (r.scoreSaved) scoreSnapshotWrittenCount += 1

    if (allSkipped) {
      skippedShopCount += 1
    } else if (fundOk && scoreOk && !fundPartial && !scorePartial) {
      succeededShopCount += 1
    } else if (fundOk || fundPartial || scoreOk || scorePartial) {
      partialShopCount += 1
    } else {
      failedShopCount += 1
      if (r.fundError) errors.push(`${r.shopKey}资金：${r.fundError}`)
      if (r.scoreReason && !r.scoreSkipped) errors.push(`${r.shopKey}店铺分：${r.scoreReason}`)
    }
  }

  let status: 'success' | 'partial_success' | 'failed' | 'skipped'
  if (attemptedShopCount === 0) status = 'skipped'
  else if (skippedShopCount === attemptedShopCount) status = 'skipped'
  else if (failedShopCount === attemptedShopCount && snapshotWrittenCount === 0) status = 'failed'
  else if (partialShopCount > 0 || (failedShopCount > 0 && succeededShopCount > 0)) {
    status = 'partial_success'
  } else if (failedShopCount > 0) status = 'failed'
  else status = 'success'

  return {
    status,
    errorSummary: errors.length ? errors.join('；') : null,
    attemptedShopCount,
    succeededShopCount,
    partialShopCount,
    failedShopCount,
    skippedShopCount,
    snapshotWrittenCount,
    scoreSnapshotWrittenCount,
  }
}
