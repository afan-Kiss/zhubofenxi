/** 今日/昨日为实时经营范围：每次打开需重读订单并重算主播归属 */
export function isRealtimeBoardPreset(preset: string | undefined | null): boolean {
  return preset === 'today' || preset === 'yesterday'
}

/** 解析日报/看板请求的有效 preset（单日 custom 与 today/yesterday 对齐缓存键） */
export function resolveBoardPresetForSingleDay(params: {
  preset?: string
  startDate: string
  endDate: string
}): string {
  if (isRealtimeBoardPreset(params.preset)) return params.preset!
  if (params.startDate !== params.endDate) return params.preset ?? 'custom'

  const todayKey = formatShanghaiDateKey(new Date())
  const yesterdayKey = formatShanghaiDateKey(addDays(new Date(), -1))
  if (params.startDate === todayKey) return 'today'
  if (params.startDate === yesterdayKey) return 'yesterday'
  return params.preset ?? 'custom'
}

function formatShanghaiDateKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}
