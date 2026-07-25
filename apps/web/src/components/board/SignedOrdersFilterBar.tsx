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
  const visibleAnchors = shopId
    ? anchors.filter((a) => a.liveAccountId === shopId)
    : anchors

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#E3E7E2] bg-[#FBFCFA] p-3 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="flex min-w-[140px] flex-1 flex-col gap-0.5 text-[11px] text-[#667069]">
        店铺
        <select
          value={shopId}
          disabled={disabled}
          onChange={(e) => onShopChange(e.target.value)}
          className="h-9 rounded-lg border border-[#E3E7E2] bg-white px-2 text-xs text-[#202722] outline-none focus:border-[#477A5D]"
        >
          <option value="">全部店铺</option>
          {shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（{s.count}）
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
            <option key={`${a.liveAccountId}-${a.id}`} value={a.id}>
              {a.name}（{a.count}）
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
        <span
          className="inline-flex h-9 items-center rounded-lg border border-[#E3E7E2] bg-[#EDF5F0] px-2.5 text-[11px] text-[#477A5D]"
          title="本页固定按店铺→主播→签收时间排序，不可切换"
        >
          店铺 ↑　主播 ↑　签收时间 ↓
        </span>
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
