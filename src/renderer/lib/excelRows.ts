import type { ImportedExcelFile } from '../types/import'

function rowHasContent(row: unknown[]): boolean {
  return row.some((cell) => String(cell ?? '').trim() !== '')
}

function findHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const nonEmpty = row.filter((cell) => String(cell ?? '').trim() !== '')
    if (nonEmpty.length >= 2) return i
  }
  return -1
}

export interface ExcelDataRows {
  headerRowIndex: number
  headers: string[]
  dataRows: Record<string, unknown>[]
}

/** 从已导入文件的 rawRows 提取表头与数据行对象 */
export function extractDataRowsFromFile(file: ImportedExcelFile): ExcelDataRows | null {
  const rows = file.rawRows
  if (!rows?.length) return null

  const headerIndex = findHeaderRowIndex(rows)
  if (headerIndex < 0) return null

  const headerRow = rows[headerIndex] as unknown[]
  const headers = headerRow.map((cell) => String(cell ?? '').trim())

  const dataRows: Record<string, unknown>[] = []
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!Array.isArray(row) || !rowHasContent(row)) continue

    const record: Record<string, unknown> = {}
    headers.forEach((header, colIndex) => {
      if (!header) return
      record[header] = row[colIndex] ?? ''
    })
    dataRows.push(record)
  }

  return { headerRowIndex: headerIndex, headers, dataRows }
}
