import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import type { ExcelParseResult, ParsedExcelFile } from '../types/analysis'

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
    if (findHeaderRowIndex(rows) >= 0) {
      return { sheetName, rows }
    }
  }
  return null
}

function rowsToRecords(
  rows: unknown[][],
  headerIndex: number,
  headers: string[],
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!Array.isArray(row) || !rowHasContent(row)) continue
    const record: Record<string, unknown> = {}
    headers.forEach((header, colIndex) => {
      if (!header) return
      record[header] = row[colIndex] ?? ''
    })
    records.push(record)
  }
  return records
}

export function parseExcelFile(filePath: string): ExcelParseResult {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error('Excel 文件不存在，请重新下载')
  }

  let buffer: Buffer
  try {
    buffer = fs.readFileSync(resolved)
  } catch {
    throw new Error('Excel 文件读取失败，请重新下载')
  }

  const head = buffer.subarray(0, Math.min(256, buffer.length)).toString('utf8').trim().toLowerCase()
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<head>')) {
    throw new Error('下载结果不是 Excel，可能 Cookie 失效或下载链接错误')
  }
  if (head.startsWith('{') || head.startsWith('[')) {
    throw new Error('下载结果为 JSON 错误响应，请检查 Cookie 或重新下载')
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  } catch {
    throw new Error('Excel 文件解析失败，请重新下载')
  }

  if (!workbook.SheetNames?.length) {
    throw new Error('Excel 中没有可用的 Sheet')
  }

  const picked = pickFirstValidSheet(workbook)
  if (!picked) {
    throw new Error('未找到包含有效表头的 Sheet')
  }

  const headerIndex = findHeaderRowIndex(picked.rows)
  const headerRow = picked.rows[headerIndex] as unknown[]
  const headers = headerRow
    .map((cell) => String(cell ?? '').trim())
    .filter((cell) => cell !== '')

  if (headers.length === 0) {
    throw new Error('Sheet 中没有有效表头')
  }

  const rows = rowsToRecords(picked.rows, headerIndex, headers)
  if (rows.length === 0) {
    throw new Error('Sheet 中没有有效数据行')
  }

  return {
    filePath: resolved,
    sheetName: picked.sheetName,
    headers,
    rows,
    rowCount: rows.length,
    rawRows: picked.rows,
  }
}

export function toParsedExcelFile(
  parsed: ExcelParseResult,
  fileName: string,
): ParsedExcelFile {
  return {
    fileName,
    filePath: parsed.filePath,
    sheetName: parsed.sheetName,
    headers: parsed.headers,
    rowCount: parsed.rowCount,
    rawRows: parsed.rawRows,
  }
}
