import React from 'react'
import type {
  BuyerQualityReturnRankItem,
  BuyerReturnRankItem,
} from '../types/business'
import { formatCentToMoney } from '../lib/businessAnalyzer'

interface BuyerRankingCompactProps {
  returnRanking: BuyerReturnRankItem[]
  qualityRanking: BuyerQualityReturnRankItem[]
  hasBuyerField: boolean
  onSelectBuyer?: (buyerId: string) => void
}

function RankTable({
  title,
  rows,
  cols,
  onSelect,
}: {
  title: string
  rows: Array<Record<string, string | number>>
  cols: Array<{ key: string; label: string; w?: string }>
  onSelect?: (id: string) => void
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-0.5 text-[10px] font-medium text-slate-600">{title}</div>
      <div className="xhs-scroll max-h-[72px] overflow-y-auto rounded-lg border border-slate-100 bg-white">
        <table className="w-full text-[9px]">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`px-1 py-0.5 text-left font-medium ${c.w ?? ''}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-2 py-2 text-center text-slate-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={String(row.buyerId ?? i)}
                  className="cursor-pointer border-t border-slate-50 hover:bg-rose-50/40"
                  onClick={() => onSelect?.(String(row.buyerId))}
                >
                  {cols.map((c) => (
                    <td key={c.key} className="truncate px-1 py-0.5 text-slate-700">
                      {row[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const BuyerRankingCompact: React.FC<BuyerRankingCompactProps> = ({
  returnRanking,
  qualityRanking,
  hasBuyerField,
  onSelectBuyer,
}) => {
  if (!hasBuyerField) {
    return (
      <p className="text-[10px] text-slate-500">未识别到买家 ID，无法生成买家退货排名。</p>
    )
  }

  const returnRows = returnRanking.map((r, i) => ({
    rank: i + 1,
    buyerId: r.buyerId,
    returnCount: r.returnCount,
    returnAmountCent: formatCentToMoney(r.returnAmountCent),
    latestReturnTime: r.latestReturnTime,
  }))

  const qualityRows = qualityRanking.map((r, i) => ({
    rank: i + 1,
    buyerId: r.buyerId,
    qualityReturnCount: r.qualityReturnCount,
    qualityReturnAmountCent: formatCentToMoney(r.qualityReturnAmountCent),
    reasonSummary: r.reasonSummary,
  }))

  return (
    <div className="flex min-h-0 gap-2">
      <RankTable
        title="买家退货金额 TOP10"
        rows={returnRows}
        cols={[
          { key: 'rank', label: '#', w: 'w-6' },
          { key: 'buyerId', label: '买家ID' },
          { key: 'returnCount', label: '单数', w: 'w-8' },
          { key: 'returnAmountCent', label: '金额' },
        ]}
        onSelect={onSelectBuyer}
      />
      <RankTable
        title="买家品退金额 TOP10"
        rows={qualityRows}
        cols={[
          { key: 'rank', label: '#', w: 'w-6' },
          { key: 'buyerId', label: '买家ID' },
          { key: 'qualityReturnCount', label: '单数', w: 'w-8' },
          { key: 'qualityReturnAmountCent', label: '金额' },
        ]}
        onSelect={onSelectBuyer}
      />
    </div>
  )
}
