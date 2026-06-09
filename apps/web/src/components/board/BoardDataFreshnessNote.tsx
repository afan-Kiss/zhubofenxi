import React from 'react'



interface Props {

  lastUpdatedAt: string | null

  cacheHint?: string | null

}



export const BoardDataFreshnessNote: React.FC<Props> = ({ lastUpdatedAt, cacheHint }) => {

  if (!lastUpdatedAt && !cacheHint) return null

  return (

    <p className="text-xs text-slate-500">

      {lastUpdatedAt ? (

        <>数据最后同步：{lastUpdatedAt}</>

      ) : null}

      {cacheHint && !lastUpdatedAt ? <span>{cacheHint}</span> : null}

    </p>

  )

}


