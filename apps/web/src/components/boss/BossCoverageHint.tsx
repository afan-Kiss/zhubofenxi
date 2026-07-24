import React from 'react'
import type { BossCoverageSumResult } from '../../lib/boss-dashboard-api'

const SHOP_LABEL: Record<string, string> = {
  shiyuju: '拾玉居和田玉',
  hetianyayu: '和田雅玉',
  xiangyu: '祥钰珠宝',
  xyxiangyu: 'XY祥钰珠宝',
}

export function formatCoverageSub(c: BossCoverageSumResult | undefined): string | undefined {
  if (!c) return undefined
  if (c.complete) return `已同步 ${c.coveredShopCount}/${c.requiredShopCount} 店`
  const missing = c.missingShopKeys.map((k) => SHOP_LABEL[k] ?? k).join('、')
  const stale = c.staleShopKeys.map((k) => SHOP_LABEL[k] ?? k).join('、')
  const parts = [`已同步 ${c.coveredShopCount}/${c.requiredShopCount} 店（部分数据）`]
  if (missing) parts.push(`缺失：${missing}`)
  if (stale) parts.push(`待刷新：${stale}`)
  return parts.join('；')
}

export const BossCoverageHint: React.FC<{ coverage?: BossCoverageSumResult }> = ({ coverage }) => {
  const text = formatCoverageSub(coverage)
  if (!text) return null
  return <span className={coverage?.complete ? 'text-slate-500' : 'text-amber-700'}>{text}</span>
}
