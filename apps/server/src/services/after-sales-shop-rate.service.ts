/**
 * 店铺 + 接口族限流：按实际 HTTP 间隔，不只按 requestHash
 */
const GLOBAL = globalThis as {
  __afterSalesShopEndpointLastAt?: Map<string, number>
}

const MIN_GAP_MS = 1200
const JITTER_MS = 400

function store(): Map<string, number> {
  if (!GLOBAL.__afterSalesShopEndpointLastAt) {
    GLOBAL.__afterSalesShopEndpointLastAt = new Map()
  }
  return GLOBAL.__afterSalesShopEndpointLastAt
}

export type AfterSalesEndpointFamily =
  | 'order_list_probe'
  | 'after_sales_workbench'
  | 'after_sales_other'

export async function waitShopEndpointSlot(
  liveAccountId: string,
  family: AfterSalesEndpointFamily,
): Promise<void> {
  const key = `${liveAccountId || 'legacy'}::${family}`
  const map = store()
  const last = map.get(key) ?? 0
  const jitter = Math.floor(Math.random() * JITTER_MS)
  const waitMs = Math.max(0, MIN_GAP_MS + jitter - (Date.now() - last))
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs))
  }
  map.set(key, Date.now())
}

/** 测试用：清空间隔记忆 */
export function resetShopEndpointSlotsForTest(): void {
  store().clear()
}
