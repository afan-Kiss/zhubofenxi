import React from 'react'

export type BuyerRankingProgressVariant = 'rebuilding' | 'stuck' | 'empty' | 'failed'

interface Props {
  variant: BuyerRankingProgressVariant
  progress?: number | null
  message?: string | null
  onRebuild?: () => void
  rebuildBusy?: boolean
}

function titleForVariant(variant: BuyerRankingProgressVariant): string {
  switch (variant) {
    case 'rebuilding':
      return '买家画像正在更新'
    case 'stuck':
      return '买家画像更新可能已卡住'
    case 'empty':
      return '买家画像尚未生成'
    case 'failed':
      return '买家画像更新失败'
    default:
      return '买家排行'
  }
}

function descriptionForVariant(variant: BuyerRankingProgressVariant): string {
  switch (variant) {
    case 'rebuilding':
      return '正在分析历史订单、复购、退款和商品问题售后，完成后自动显示买家排行。'
    case 'stuck':
      return '本次更新耗时较久，可以重新生成买家排行。'
    case 'empty':
      return '买家排行基于历史订单累计分析，不随经营看板日期切换。可以手动生成，也会每日 03:00 自动更新。'
    case 'failed':
      return '请检查订单和售后数据是否已同步，或稍后重试。'
    default:
      return ''
  }
}

function rebuildButtonLabel(variant: BuyerRankingProgressVariant, busy: boolean): string {
  if (busy) return '正在生成…'
  if (variant === 'empty') return '立即生成买家排行'
  return '重新生成买家排行'
}

export const BuyerRankingProgressCard: React.FC<Props> = ({
  variant,
  progress,
  message,
  onRebuild,
  rebuildBusy,
}) => {
  const showProgressBar =
    variant === 'rebuilding' && progress != null && progress > 0 && progress <= 100
  const showSpinner = variant === 'rebuilding' && !showProgressBar

  return (
    <div
      className={`rounded-2xl border bg-white py-4 px-4 sm:py-5 sm:px-5 ${
        variant === 'failed'
          ? 'border-red-200'
          : variant === 'empty'
            ? 'border-dashed border-slate-200'
            : variant === 'stuck'
              ? 'border-orange-200'
              : 'border-amber-200'
      }`}
      data-testid={`buyer-profile-card-${variant}`}
    >
      <h3 className="text-base font-semibold text-slate-900">{titleForVariant(variant)}</h3>
      <p className="mt-1.5 text-sm text-slate-600">{descriptionForVariant(variant)}</p>
      {message && (variant === 'failed' || variant === 'stuck') ? (
        <p
          className={`mt-1.5 text-xs ${variant === 'failed' ? 'text-red-700' : 'text-orange-800'}`}
        >
          {message}
        </p>
      ) : null}

      {showProgressBar ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>重建进度</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress ?? 0))}%` }}
            />
          </div>
        </div>
      ) : showSpinner ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-amber-900">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />
          正在生成买家画像…
        </div>
      ) : null}

      {onRebuild && (variant === 'empty' || variant === 'failed' || variant === 'stuck') ? (
        <div className="mt-3">
          <button
            type="button"
            disabled={rebuildBusy}
            onClick={onRebuild}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {rebuildButtonLabel(variant, Boolean(rebuildBusy))}
          </button>
        </div>
      ) : null}
    </div>
  )
}
