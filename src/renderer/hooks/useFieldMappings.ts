import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildFieldMappingResult } from '../lib/fieldMapper'
import type { FieldMappingResult } from '../types/fieldMapping'
import type { ImportedExcelFile } from '../types/import'

type OverrideStore = Record<string, Record<string, string | null>>

export function useFieldMappings(
  importedFiles: ImportedExcelFile[],
  selectedOrderFile: string | null,
  selectedLiveFile: string | null,
  selectedPendingSettlementFile: string | null,
  selectedSettledSettlementFile: string | null,
) {
  const [overrides, setOverrides] = useState<OverrideStore>({})

  useEffect(() => {
    setOverrides((prev) => {
      const validIds = new Set(importedFiles.map((f) => f.id))
      const next: OverrideStore = {}
      for (const [fileId, fields] of Object.entries(prev)) {
        if (validIds.has(fileId)) next[fileId] = fields
      }
      return next
    })
  }, [importedFiles])

  const buildForFile = useCallback(
    (file: ImportedExcelFile | undefined): FieldMappingResult | null => {
      if (!file || file.status === 'error' || !file.headers.length) return null
      if (file.fileType === 'unknown') return null

      return buildFieldMappingResult(
        file.id,
        file.fileName,
        file.fileType,
        file.headers,
        overrides[file.id],
      )
    },
    [overrides],
  )

  const orderFile = useMemo(
    () => importedFiles.find((f) => f.id === selectedOrderFile),
    [importedFiles, selectedOrderFile],
  )
  const liveFile = useMemo(
    () => importedFiles.find((f) => f.id === selectedLiveFile),
    [importedFiles, selectedLiveFile],
  )
  const pendingSettlementFile = useMemo(
    () => importedFiles.find((f) => f.id === selectedPendingSettlementFile),
    [importedFiles, selectedPendingSettlementFile],
  )
  const settledSettlementFile = useMemo(
    () => importedFiles.find((f) => f.id === selectedSettledSettlementFile),
    [importedFiles, selectedSettledSettlementFile],
  )

  const orderMapping = useMemo(() => buildForFile(orderFile), [buildForFile, orderFile])
  const liveMapping = useMemo(() => buildForFile(liveFile), [buildForFile, liveFile])
  const pendingSettlementMapping = useMemo(
    () => buildForFile(pendingSettlementFile),
    [buildForFile, pendingSettlementFile],
  )
  const settledSettlementMapping = useMemo(
    () => buildForFile(settledSettlementFile),
    [buildForFile, settledSettlementFile],
  )

  const updateFieldMapping = useCallback(
    (fileId: string, fieldKey: string, header: string | null) => {
      setOverrides((prev) => ({
        ...prev,
        [fileId]: {
          ...prev[fileId],
          [fieldKey]: header === '' ? null : header,
        },
      }))
    },
    [],
  )

  return {
    orderMapping,
    liveMapping,
    pendingSettlementMapping,
    settledSettlementMapping,
    orderFile,
    liveFile,
    pendingSettlementFile,
    settledSettlementFile,
    updateFieldMapping,
  }
}
