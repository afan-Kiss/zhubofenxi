export interface OpenExcelDialogResult {
  canceled: boolean
  filePaths: string[]
}

import type { AnchorConfig } from './types/anchor'

export interface DashboardAPI {
  version: string
  openExcelDialog: () => Promise<OpenExcelDialogResult>
  readExcelFile: (filePath: string) => Promise<ArrayBuffer>
  getAnchorConfig: () => Promise<AnchorConfig>
  saveAnchorConfig: (config: AnchorConfig) => Promise<{ ok: boolean }>
  resetAnchorConfig: () => Promise<AnchorConfig>
}

declare global {
  interface Window {
    dashboardAPI?: DashboardAPI
  }
}

export {}
