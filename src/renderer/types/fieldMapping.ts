import type { ExcelFileType } from './import'

export type MatchConfidence = 'exact' | 'fuzzy' | 'missing' | 'manual'

export interface FieldDefinition {
  key: string
  label: string
  keywords: string[]
  required?: boolean
  recommended?: boolean
}

export interface FieldMappingEntry {
  key: string
  label: string
  header: string | null
  confidence: MatchConfidence
  required: boolean
}

export interface FieldMappingResult {
  fileId: string
  fileType: ExcelFileType
  fileName: string
  mappings: FieldMappingEntry[]
  missingRequiredFields: string[]
  warnings: string[]
}
