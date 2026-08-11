import React from 'react'
import { BarChart3 } from 'lucide-react'

/**
 * 原运营报表入口：日报/周报/月报/榜单 UI 已停用（代码保留在同目录其他文件）。
 * 菜单更名为「上月对比」；结算/同步不再预热运营报表缓存。
 */
export function OperationsReportPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6" data-testid="month-compare-placeholder">
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
          <BarChart3 className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-slate-900">上月对比</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          本页用于经营上月对比。原运营报表（日报 / 周报 / 月报 / 榜单）已停用展示，相关计算也不再随同步自动跑。
        </p>
        <p className="mt-4 text-sm text-slate-400">对比内容后续上线，当前为占位页。</p>
      </div>
    </div>
  )
}
