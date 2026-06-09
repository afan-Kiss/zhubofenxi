export type ExcelFileType =
  | 'order'
  | 'live'
  | 'pendingSettlement'
  | 'settledSettlement'
  | 'unknown'

export type ImportFileStatus = 'identified' | 'needs_confirm' | 'error'

export interface ImportedExcelFile {
  id: string
  fileName: string
  filePath?: string
  fileType: ExcelFileType
  sheetName: string
  sheetNames: string[]
  headers: string[]
  rowCount: number
  status: ImportFileStatus
  errorMessage?: string
  rawRows?: unknown[][]
}

export interface ImportSelection {
  selectedOrderFile: string | null
  selectedLiveFile: string | null
  selectedPendingSettlementFile: string | null
  selectedSettledSettlementFile: string | null
}
