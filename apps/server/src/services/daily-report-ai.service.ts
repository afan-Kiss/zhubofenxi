export interface DailyReportAnchorAiInput {
  anchorName: string
  sessionLabel: string
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  liveDurationMinutes: number
  avgOrderAmountYuan: number | null
  hourlyAmountYuan: number | null
  dealDensityMinutes: number | null
  amountRatio: number | null
}

export function buildDailyReportAiSuggestions(
  anchors: DailyReportAnchorAiInput[],
): string[] {
  if (anchors.length === 0) {
    return ['昨日整体数据正常，建议继续保持当前直播节奏，同时关注售后情况。']
  }

  const suggestions: string[] = []
  const usedTexts = new Set<string>()

  const add = (text: string) => {
    if (suggestions.length >= 3 || usedTexts.has(text)) return
    usedTexts.add(text)
    suggestions.push(text)
  }

  const byShipped = [...anchors].sort((a, b) => b.shippedAmountYuan - a.shippedAmountYuan)
  const topShipped = byShipped[0]
  if (topShipped && topShipped.shippedAmountYuan > 0) {
    add(
      `${topShipped.anchorName}昨日金额贡献最高，${topShipped.sessionLabel}可以继续重点安排。`,
    )
  }

  const byHourly = [...anchors]
    .filter((a) => a.hourlyAmountYuan != null && a.hourlyAmountYuan > 0)
    .sort((a, b) => (b.hourlyAmountYuan ?? 0) - (a.hourlyAmountYuan ?? 0))
  const topHourly = byHourly[0]
  if (
    topHourly &&
    topHourly.anchorName !== topShipped?.anchorName &&
    topHourly.hourlyAmountYuan != null
  ) {
    add(`${topHourly.anchorName}时均产出较高，说明该时段转化效率不错。`)
  }

  const byInvalid = [...anchors].sort((a, b) => b.invalidOrderCount - a.invalidOrderCount)
  const topInvalid = byInvalid[0]
  if (topInvalid && topInvalid.invalidOrderCount > 0) {
    add(
      `${topInvalid.anchorName}有${topInvalid.invalidOrderCount}单异常单，建议复盘商品、价格和售后原因。`,
    )
  }

  const densityCandidate = [...anchors]
    .filter(
      (a) =>
        a.soldOrderCount > 0 &&
        a.avgOrderAmountYuan != null &&
        a.avgOrderAmountYuan >= 3000 &&
        a.dealDensityMinutes != null &&
        a.dealDensityMinutes >= 60,
    )
    .sort((a, b) => (b.dealDensityMinutes ?? 0) - (a.dealDensityMinutes ?? 0))[0]
  if (densityCandidate) {
    add(`${densityCandidate.anchorName}客单价高，但成交密度偏低，建议加强逼单节奏。`)
  }

  const longLiveCandidate = [...anchors]
    .filter(
      (a) =>
        a.liveDurationMinutes >= 180 &&
        a.soldOrderCount > 0 &&
        a.soldOrderCount <= 3 &&
        (a.dealDensityMinutes ?? 0) >= 90,
    )
    .sort((a, b) => (b.dealDensityMinutes ?? 0) - (a.dealDensityMinutes ?? 0))[0]
  if (longLiveCandidate) {
    add(
      `${longLiveCandidate.anchorName}直播时间不短，但出单间隔偏长，建议优化开场节奏和货盘顺序。`,
    )
  }

  if (suggestions.length === 0) {
    return ['昨日整体数据正常，建议继续保持当前直播节奏，同时关注售后情况。']
  }
  return suggestions.slice(0, 3)
}
