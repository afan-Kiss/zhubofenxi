import { useCallback, useMemo, useState } from 'react'
import { isExcelFileName, loadExcelFromFile, loadExcelFromPath } from '../lib/excelLoader'
import { resolveImportStatus } from '../lib/fileClassifier'
import type { ImportedExcelFile } from '../types/import'

function pickSelectionId(
  files: ImportedExcelFile[],
  type: ImportedExcelFile['fileType'],
  current: string | null,
): string | null {
  if (current && files.some((f) => f.id === current && f.fileType === type && f.status !== 'error')) {
    return current
  }
  const match = files.find((f) => f.fileType === type && f.status !== 'error')
  return match?.id ?? null
}

export function useImportedFiles() {
  const [importedFiles, setImportedFiles] = useState<ImportedExcelFile[]>([])
  const [selectedOrderFile, setSelectedOrderFile] = useState<string | null>(null)
  const [selectedLiveFile, setSelectedLiveFile] = useState<string | null>(null)
  const [selectedPendingSettlementFile, setSelectedPendingSettlementFile] = useState<string | null>(null)
  const [selectedSettledSettlementFile, setSelectedSettledSettlementFile] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  const mergeImported = useCallback((incoming: ImportedExcelFile[]) => {
    if (!incoming.length) return

    setImportedFiles((prev) => {
      let next = [...prev]

      for (const file of incoming) {
        const duplicate = next.find(
          (p) =>
            p.fileName === file.fileName &&
            (p.filePath ? p.filePath === file.filePath : true),
        )
        if (duplicate) {
          next = next.map((item) => (item.id === duplicate.id ? { ...file, id: duplicate.id } : item))
        } else {
          if (file.fileType !== 'unknown') {
            const existingSameType = next.find((p) => p.fileType === file.fileType && p.status !== 'error')
            if (existingSameType) {
              next = next.filter((p) => p.id !== existingSameType.id)
            }
          }
          next.push(file)
        }
      }

      setSelectedOrderFile((cur) => pickSelectionId(next, 'order', cur))
      setSelectedLiveFile((cur) => pickSelectionId(next, 'live', cur))
      setSelectedPendingSettlementFile((cur) =>
        pickSelectionId(next, 'pendingSettlement', cur),
      )
      setSelectedSettledSettlementFile((cur) =>
        pickSelectionId(next, 'settledSettlement', cur),
      )

      return next
    })
  }, [])

  const importFromFileList = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      const excelFiles = list.filter((f) => isExcelFileName(f.name))
      const skipped = list.length - excelFiles.length

      if (!excelFiles.length) {
        showToast('仅支持 .xlsx / .xls 文件，请重新选择')
        return
      }

      if (skipped > 0) {
        showToast(`已跳过 ${skipped} 个非 Excel 文件`)
      }

      const results = await Promise.all(excelFiles.map((f) => loadExcelFromFile(f)))
      mergeImported(results)
    },
    [mergeImported, showToast],
  )

  const importFromPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return

      const api = window.dashboardAPI
      if (!api?.readExcelFile) {
        showToast('当前环境无法通过路径读取文件')
        return
      }

      const results = await Promise.all(
        paths.map((p) => loadExcelFromPath(p, api.readExcelFile)),
      )
      mergeImported(results)
    },
    [mergeImported, showToast],
  )

  const openFileDialog = useCallback(async () => {
    const api = window.dashboardAPI
    if (!api?.openExcelDialog) {
      showToast('请在 Electron 窗口中使用导入功能')
      return
    }

    const result = await api.openExcelDialog()
    if (result.canceled || !result.filePaths.length) return
    await importFromPaths(result.filePaths)
  }, [importFromPaths, showToast])

  const removeFile = useCallback((id: string) => {
    setImportedFiles((prev) => {
      const next = prev.filter((f) => f.id !== id)
      setSelectedOrderFile((cur) => pickSelectionId(next, 'order', cur === id ? null : cur))
      setSelectedLiveFile((cur) => pickSelectionId(next, 'live', cur === id ? null : cur))
      setSelectedPendingSettlementFile((cur) =>
        pickSelectionId(next, 'pendingSettlement', cur === id ? null : cur),
      )
      setSelectedSettledSettlementFile((cur) =>
        pickSelectionId(next, 'settledSettlement', cur === id ? null : cur),
      )
      return next
    })
  }, [])

  const updateFileType = useCallback(
    (id: string, nextType: ImportedExcelFile['fileType']) => {
      setImportedFiles((prev) => {
        const target = prev.find((f) => f.id === id)
        if (!target) return prev
        if (target.fileType === nextType) return prev

        let working = [...prev]
        if (nextType !== 'unknown') {
          const existing = prev.find(
            (f) => f.id !== id && f.fileType === nextType && f.status !== 'error',
          )
          if (existing) {
            const ok = window.confirm(`${nextType} 槽位已有文件，是否替换为当前文件？`)
            if (!ok) return prev
            working = working.filter((f) => f.id !== existing.id)
          }
        }

        working = working.map((f) =>
          f.id === id
            ? {
                ...f,
                fileType: nextType,
                status: resolveImportStatus(nextType, f.errorMessage),
              }
            : f,
        )

        setSelectedOrderFile((cur) => pickSelectionId(working, 'order', cur))
        setSelectedLiveFile((cur) => pickSelectionId(working, 'live', cur))
        setSelectedPendingSettlementFile((cur) =>
          pickSelectionId(working, 'pendingSettlement', cur),
        )
        setSelectedSettledSettlementFile((cur) =>
          pickSelectionId(working, 'settledSettlement', cur),
        )

        return working
      })
    },
    [],
  )

  const importCount = importedFiles.length

  const selectionSummary = useMemo(
    () => ({
      order: importedFiles.find((f) => f.id === selectedOrderFile)?.fileName,
      live: importedFiles.find((f) => f.id === selectedLiveFile)?.fileName,
      pendingSettlement: importedFiles.find((f) => f.id === selectedPendingSettlementFile)
        ?.fileName,
      settledSettlement: importedFiles.find((f) => f.id === selectedSettledSettlementFile)
        ?.fileName,
    }),
    [
      importedFiles,
      selectedOrderFile,
      selectedLiveFile,
      selectedPendingSettlementFile,
      selectedSettledSettlementFile,
    ],
  )

  const slotFiles = useMemo(
    () => ({
      order: importedFiles.find((f) => f.id === selectedOrderFile),
      live: importedFiles.find((f) => f.id === selectedLiveFile),
      pendingSettlement: importedFiles.find((f) => f.id === selectedPendingSettlementFile),
      settledSettlement: importedFiles.find((f) => f.id === selectedSettledSettlementFile),
      unknown: importedFiles.filter((f) => f.fileType === 'unknown'),
    }),
    [
      importedFiles,
      selectedOrderFile,
      selectedLiveFile,
      selectedPendingSettlementFile,
      selectedSettledSettlementFile,
    ],
  )

  return {
    importedFiles,
    selectedOrderFile,
    selectedLiveFile,
    selectedPendingSettlementFile,
    selectedSettledSettlementFile,
    slotFiles,
    importCount,
    selectionSummary,
    toast,
    importFromFileList,
    openFileDialog,
    removeFile,
    updateFileType,
  }
}
