import type { FieldMappingResult } from '../types/fieldMapping'
import type { ImportedExcelFile } from '../types/import'
import type { OrderDedupeResult } from '../types/order'
import { dedupeOrders } from './orderDeduper'
import { normalizeOrders } from './orderNormalizer'

export interface OrderPreprocessResult {
  ok: boolean
  message?: string
  dedupeResult?: OrderDedupeResult
}

export function canPreprocessOrders(
  orderFile: ImportedExcelFile | undefined,
  orderMapping: FieldMappingResult | null,
): boolean {
  if (!orderFile || !orderMapping) return false
  if (orderFile.status === 'error') return false

  const requiredKeys = ['orderId', 'orderTime', 'gmvAmount']
  return requiredKeys.every((key) => {
    const item = orderMapping.mappings.find((m) => m.key === key)
    return Boolean(item?.header)
  })
}

export function preprocessOrders(
  orderFile: ImportedExcelFile,
  orderMapping: FieldMappingResult,
): OrderPreprocessResult {
  if (!canPreprocessOrders(orderFile, orderMapping)) {
    return {
      ok: false,
      message: '订单表缺少关键字段，请先完成字段映射',
    }
  }

  try {
    const normalized = normalizeOrders(orderFile, orderMapping)
    const dedupeResult = dedupeOrders(normalized)
    return { ok: true, dedupeResult }
  } catch (err) {
    const message = err instanceof Error ? err.message : '预处理失败'
    return { ok: false, message }
  }
}
