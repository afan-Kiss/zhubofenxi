/**
 * 店铺平台请求限流：同店串行 Promise 链 + 最低间隔（订单列表与售后详情共享）
 */
const GLOBAL = globalThis as {
  __afterSalesShopPlatformLastAt?: Map<string, number>
  __afterSalesShopPlatformTail?: Map<string, Promise<void>>
}

/** 同店任意售后相关平台请求最低间隔（ms） */
export const AFTER_SALES_SHOP_MIN_GAP_MS = 1200
const JITTER_MS = 400

function lastStore(): Map<string, number> {
  if (!GLOBAL.__afterSalesShopPlatformLastAt) {
    GLOBAL.__afterSalesShopPlatformLastAt = new Map()
  }
  return GLOBAL.__afterSalesShopPlatformLastAt
}

function tailStore(): Map<string, Promise<void>> {
  if (!GLOBAL.__afterSalesShopPlatformTail) {
    GLOBAL.__afterSalesShopPlatformTail = new Map()
  }
  return GLOBAL.__afterSalesShopPlatformTail
}

export type AfterSalesEndpointFamily =
  | 'order_list_probe'
  | 'after_sales_workbench'
  | 'after_sales_other'

/**
 * 同店平台请求槽位：串行排队，保证并发调用也不会穿透间隔。
 * endpoint family 仅语义标记；间隔按 liveAccountId 共享。
 */
export async function waitShopPlatformSlot(
  liveAccountId: string,
  opts?: { gapMs?: number; jitterMs?: number },
): Promise<void> {
  const shopKey = String(liveAccountId ?? '').trim() || 'legacy'
  const gapMs = opts?.gapMs ?? AFTER_SALES_SHOP_MIN_GAP_MS
  const jitterMs = opts?.jitterMs ?? JITTER_MS
  const tails = tailStore()
  const prev = tails.get(shopKey) ?? Promise.resolve()

  let release!: () => void
  const done = new Promise<void>((resolve) => {
    release = resolve
  })
  // 链上挂上当前任务完成信号，后继 await prev 时等到本任务释放
  tails.set(
    shopKey,
    prev.then(() => done).catch(() => done),
  )

  await prev
  try {
    const map = lastStore()
    const last = map.get(shopKey) ?? 0
    const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0
    const waitMs = Math.max(0, gapMs + jitter - (Date.now() - last))
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs))
    }
    map.set(shopKey, Date.now())
  } finally {
    release()
  }
}

/** @deprecated 兼容旧名：同店共享平台间隔 */
export async function waitShopEndpointSlot(
  liveAccountId: string,
  _family?: AfterSalesEndpointFamily,
): Promise<void> {
  await waitShopPlatformSlot(liveAccountId)
}

/** 测试用：清空间隔记忆与排队链 */
export function resetShopEndpointSlotsForTest(): void {
  lastStore().clear()
  tailStore().clear()
}
