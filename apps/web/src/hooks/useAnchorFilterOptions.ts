import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../lib/api'

interface AnchorOptionsResponse {
  filterNames: string[]
  anchors: Array<{ id: string; name: string; color: string }>
}

export function useAnchorFilterOptions(): {
  filterNames: string[]
  anchors: AnchorOptionsResponse['anchors']
  loading: boolean
  reload: () => Promise<void>
} {
  const [filterNames, setFilterNames] = useState<string[]>(['全部', '其他'])
  const [anchors, setAnchors] = useState<AnchorOptionsResponse['anchors']>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiRequest<AnchorOptionsResponse>('/api/anchors/options')
      setFilterNames(data.filterNames.length > 0 ? data.filterNames : ['全部', '其他'])
      setAnchors(data.anchors)
    } catch {
      setFilterNames(['全部', '其他'])
      setAnchors([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { filterNames, anchors, loading, reload }
}
