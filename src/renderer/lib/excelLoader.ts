import * as XLSX from 'xlsx'
import { classifyByHeaders, resolveImportStatus } from './fileClassifier'
import type { ImportedExcelFile } from '../types/import'

const EXCEL_EXTENSIONS = ['.xlsx', '.xls']

export function isExcelFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return EXCEL_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function createId(): string {
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

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

function pickFirstValidSheet(
  workbook: XLSX.WorkBook,
): { sheetName: string; rows: unknown[][] } | null {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    })

    if (!Array.isArray(rows) || rows.length === 0) continue

    const headerIndex = findHeaderRowIndex(rows)
    if (headerIndex >= 0) {
      return { sheetName, rows }
    }
  }
  return null
}

export function parseExcelBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  filePath?: string,
): ImportedExcelFile {
  const base: ImportedExcelFile = {
    id: createId(),
    fileName,
    filePath,
    fileType: 'unknown',
    sheetName: '',
    sheetNames: [],
    headers: [],
    rowCount: 0,
    status: 'error',
  }

  try {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
    base.sheetNames = workbook.SheetNames ?? []

    if (!base.sheetNames.length) {
      return {
        ...base,
        errorMessage: 'Excel 中没有可用的 Sheet',
      }
    }

    const picked = pickFirstValidSheet(workbook)
    if (!picked) {
      return {
        ...base,
        errorMessage: '未找到包含有效表头的 Sheet',
      }
    }

    const { sheetName, rows } = picked
    const headerIndex = findHeaderRowIndex(rows)
    const headerRow = rows[headerIndex] as unknown[]

    const headers = headerRow
      .map((cell) => String(cell ?? '').trim())
      .filter((cell) => cell !== '')

    if (headers.length === 0) {
      return {
        ...base,
        sheetName,
        errorMessage: 'Sheet 中没有有效表头',
      }
    }

    const dataRows = rows.slice(headerIndex + 1).filter((row) => {
      if (!Array.isArray(row)) return false
      return rowHasContent(row)
    })

    const fileType = classifyByHeaders(headers, fileName)
    const status = resolveImportStatus(fileType)

    return {
      ...base,
      sheetName,
      headers,
      rowCount: dataRows.length,
      fileType,
      status,
      rawRows: rows,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Excel 文件读取失败'
    return {
      ...base,
      errorMessage: message,
    }
  }
}

export async function loadExcelFromFile(file: File): Promise<ImportedExcelFile> {
  if (!isExcelFileName(file.name)) {
    return {
      id: createId(),
      fileName: file.name,
      fileType: 'unknown',
      sheetName: '',
      sheetNames: [],
      headers: [],
      rowCount: 0,
      status: 'error',
      errorMessage: '不支持的文件格式，请使用 .xlsx 或 .xls',
    }
  }

  const buffer = await file.arrayBuffer()
  return parseExcelBuffer(buffer, file.name)
}

export async function loadExcelFromPath(
  filePath: string,
  readBuffer: (path: string) => Promise<ArrayBuffer>,
): Promise<ImportedExcelFile> {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath

  if (!isExcelFileName(fileName)) {
    return {
      id: createId(),
      fileName,
      filePath,
      fileType: 'unknown',
      sheetName: '',
      sheetNames: [],
      headers: [],
      rowCount: 0,
      status: 'error',
      errorMessage: '不支持的文件格式，请使用 .xlsx 或 .xls',
    }
  }

  try {
    const buffer = await readBuffer(filePath)
    return parseExcelBuffer(buffer, fileName, filePath)
  } catch (err) {
    const message = err instanceof Error ? err.message : '无法读取文件'
    return {
      id: createId(),
      fileName,
      filePath,
      fileType: 'unknown',
      sheetName: '',
      sheetNames: [],
      headers: [],
      rowCount: 0,
      status: 'error',
      errorMessage: message,
    }
  }
}
