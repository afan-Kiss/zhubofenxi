import ExcelJS from 'exceljs'
import path from 'node:path'

const file = path.resolve(
  process.cwd(),
  '../../真实表格/小红书订单查询2026-05-28-15_25_05fdadc9.xlsx',
)
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(file)
const sheet = wb.worksheets[0]!
const row1 = sheet.getRow(1)
row1.eachCell((cell, col) => {
  const h = String(cell.value ?? '')
  const v = sheet.getRow(2).getCell(col).value
  if (h.includes('时间') || h.includes('订单号') || h === '订单状态') {
    console.log(JSON.stringify({ h, v, type: typeof v }))
  }
})
