import React from 'react'

export type SignedFilterShop = { id: string; name: string; count: number }
export type SignedFilterAnchor = {
  id: string
  name: string
  liveAccountId: string
  count: number
}

interface Props {
  shops: SignedFilterShop[]
  anchors: SignedFilterAnchor[]
  shopId: string
  anchorId: string
  keyword: string
  onShopChange: (shopId: string) => void
  onAnchorChange: (anchorId: string) => void
  onKeywordChange: (keyword: string) => void
  onReset: () => void
  hasActiveFilters: boolean
  disabled?: boolean
}

function normalizeNameKey(name: string): string {
  return name
    .trim()
    .normalize('NFKC')
    .replace(/\u3000/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 全部店铺时按主播名合并；选中店铺时也按名合并（防同店多 id）。下拉只展示名称，不带单数。 */
function mergeAnchorsForSelect(
  anchors: SignedFilterAnchor[],
  shopId: string,
): SignedFilterAnchor[] {
  const scoped = shopId
    ? anchors.filter((a) => a.liveAccountId === shopId)
    : anchors
  const map = new Map<string, SignedFilterAnchor>()
  for (const a of scoped) {
    const displayName = (a.name || '').trim() || '未归属'
    const unassigned =
      a.id === '__unassigned__' || displayName === '未归属' || displayName === '—'
    const key = unassigned ? '__unassigned__' : normalizeNameKey(displayName)
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        id: unassigned ? '__unassigned__' : displayName,
        name: unassigned ? '未归属' : displayName,
        liveAccountId: shopId || '',
        count: a.count,
      })
    } else {
      existing.count += a.count
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.id === '__unassigned__' && b.id !== '__unassigned__') return 1
    if (b.id === '__unassigned__' && a.id !== '__unassigned__') return -1
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
  })
}

export const SignedOrdersFilterBar: React.FC<Props> = ({
  shops,
  anchors,
  shopId,
  anchorId,
  keyword,
  onShopChange,
  onAnchorChange,
  onKeywordChange,
  onReset,
  hasActiveFilters,
  disabled,
}) => {
  const visibleAnchors = mergeAnchorsForSelect(anchors, shopId)
  const shopOptions = [...shops].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }),
  )

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#E3E7E2] bg-[#FBFCFA] p-3 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="flex min-w-[140px] flex-1 flex-col gap-0.5 text-[11px] text-[#667069]">
        店铺
        <select
          value={shopId}
          disabled={disabled}
          onChange={(e) => {
            onShopChange(e.target.value)
            onAnchorChange('')
          }}
          className="h-9 rounded-lg border border-[#E3E7E2] bg-white px-2 text-xs text-[#202722] outline-none focus:border-[#477A5D]"
        >
          <option value="">全部店铺</option>
          {shopOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-[120px] flex-1 flex-col gap-0.5 text-[11px] text-[#667069]">
        主播
        <select
          value={anchorId}
          disabled={disabled}
          onChange={(e) => onAnchorChange(e.target.value)}
          className="h-9 rounded-lg border border-[#E3E7E2] bg-white px-2 text-xs text-[#202722] outline-none focus:border-[#477A5D]"
        >
          <option value="">全部主播</option>
          {visibleAnchors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-[180px] flex-[2] flex-col gap-0.5 text-[11px] text-[#667069]">
        搜索
        <input
          type="search"
          value={keyword}
          disabled={disabled}
          placeholder="订单号 / 买家昵称 / 商品名称"
          onChange={(e) => onKeywordChange(e.target.value)}
          className="h-9 rounded-lg border border-[#E3E7E2] bg-white px-2 text-xs text-[#202722] outline-none focus:border-[#477A5D]"
        />
      </label>

      <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
        <button
          type="button"
          disabled={disabled || !hasActiveFilters}
          onClick={onReset}
          className="h-9 rounded-lg border border-[#E3E7E2] bg-white px-3 text-xs text-[#667069] transition hover:bg-[#F2F5F2] disabled:cursor-not-allowed disabled:opacity-40"
        >
          重置筛选
        </button>
      </div>
    </div>
  )
}
