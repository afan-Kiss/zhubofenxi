import React from 'react'

interface Props {
  nickname: string
  buyerId?: string
  /** 同名买家区分用短识别码（单独一行展示，不拼进昵称） */
  identityCode?: string
  isBlacklisted?: boolean
  className?: string
}

/** 品退风险买家：红名 +「品退」标签，提示建议谨慎发货 */
export const BuyerDisplay: React.FC<Props> = ({
  nickname,
  buyerId,
  identityCode,
  isBlacklisted,
  className = '',
}) => {
  const title = isBlacklisted
    ? '该买家存在品退订单，建议谨慎发货'
    : identityCode
      ? '同名买家已按买家ID区分'
      : undefined

  return (
    <span className={`inline-flex flex-col gap-0.5 ${className}`} title={title}>
      <span className="inline-flex flex-wrap items-center gap-1">
        <span className={isBlacklisted ? 'font-medium text-red-600' : ''}>{nickname}</span>
        {isBlacklisted && (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
            品退
          </span>
        )}
        {buyerId && isBlacklisted && <span className="sr-only">买家ID {buyerId}</span>}
      </span>
      {identityCode ? (
        <span className="font-mono text-[10px] text-slate-400">识别码 {identityCode}</span>
      ) : null}
    </span>
  )
}
