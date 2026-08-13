/**
 * 归属诊断透传 / unknownSyncShop 语义 / auth 中途返回 — 专项验收
 */
import assert from 'node:assert/strict'
import {
  appendOwnershipSyncWarnings,
  buildOwnershipSyncSummary,
  computeUnknownSellerRate,
  emptyOwnershipSyncSummary,
  isUnknownSellerRateDegraded,
  resolveSyncShopIdentityFromFields,
} from '../src/services/sync-shop-identity.service'
import type { SyncOrderListOnlyResult, SyncOrderListResult } from '../src/services/xhs-api-sync/xhs-order-sync.service'

/** 与 syncOrderList() 透传字段保持一致的投影（可单测，避免真跑网络） */
function projectSyncOrderListResult(result: SyncOrderListOnlyResult): SyncOrderListResult {
  return {
    itemCount: result.savedCount ?? result.itemCount,
    requestCount: result.pageCount,
    warnings: result.warnings,
    authFailed: result.authFailed,
    syncStopped: result.syncStopped,
    apiRowCount: result.itemCount,
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
    matchedCount: result.matchedCount,
    crossShopSkippedCount: result.crossShopSkippedCount,
    unknownSellerCount: result.unknownSellerCount,
    unknownSellerRate: result.unknownSellerRate,
    unknownSyncShopCount: result.unknownSyncShopCount,
    resolvedSyncShopKey: result.resolvedSyncShopKey,
    syncShopIdentitySource: result.syncShopIdentitySource,
    syncShopUnknown: result.syncShopUnknown,
    ownershipDegraded: result.ownershipDegraded,
  }
}

function main() {
  const ht = resolveSyncShopIdentityFromFields({
    liveAccountId: 'acc-ht',
    liveAccountName: '和田雅玉',
    credentialPlatformName: 'hetianyayu',
  })

  // 1: 正常
  const ok = buildOwnershipSyncSummary({
    itemCount: 100,
    matchedCount: 100,
    crossShopSkippedCount: 0,
    unknownSellerCount: 0,
    orderLevelUnknownSyncShopCount: 0,
    syncIdentity: ht,
  })
  assert.equal(ok.unknownSellerRate, 0)
  assert.equal(ok.unknownSyncShopCount, 0)
  assert.equal(ok.syncShopUnknown, false)
  assert.equal(ok.ownershipDegraded, false)
  assert.equal(ok.resolvedSyncShopKey, 'hetianyayu')
  assert.equal(ok.syncShopIdentitySource, 'platform_credential')

  // 2: 账号无法识别 1000 单
  const unknownAcc = resolveSyncShopIdentityFromFields({
    liveAccountId: 'legacy',
    liveAccountName: '临时未知店',
  })
  const unk = buildOwnershipSyncSummary({
    itemCount: 1000,
    matchedCount: 0,
    crossShopSkippedCount: 0,
    unknownSellerCount: 0,
    orderLevelUnknownSyncShopCount: 0,
    syncIdentity: unknownAcc,
  })
  assert.equal(unk.syncShopUnknown, true)
  assert.equal(unk.unknownSyncShopCount, 1000)
  assert.equal(unk.ownershipDegraded, true)

  // 3: 账号 unknown + 300 seller unknown（count 可重叠）
  const both = buildOwnershipSyncSummary({
    itemCount: 1000,
    matchedCount: 700,
    crossShopSkippedCount: 0,
    unknownSellerCount: 300,
    orderLevelUnknownSyncShopCount: 50,
    syncIdentity: unknownAcc,
  })
  assert.equal(both.unknownSellerCount, 300)
  assert.equal(both.unknownSellerRate, 0.3)
  assert.equal(both.unknownSyncShopCount, 1000)
  assert.equal(both.syncShopUnknown, true)
  assert.equal(both.ownershipDegraded, true)

  // 4: auth 中途失败 — 已处理 800 单仍有完整诊断
  const mid = buildOwnershipSyncSummary({
    itemCount: 800,
    matchedCount: 740,
    crossShopSkippedCount: 0,
    unknownSellerCount: 60,
    orderLevelUnknownSyncShopCount: 0,
    syncIdentity: ht,
  })
  const midProjected = projectSyncOrderListResult({
    total: 800,
    itemCount: 800,
    pageCount: 2,
    savedCount: 800,
    firstOrderId: '1',
    firstPackageId: 'P1',
    warnings: ['Cookie 失效'],
    authFailed: true,
    syncStopped: true,
    createdCount: 800,
    updatedCount: 0,
    ...mid,
  })
  assert.equal(midProjected.authFailed, true)
  assert.equal(midProjected.matchedCount, 740)
  assert.equal(midProjected.unknownSellerCount, 60)
  assert.equal(midProjected.unknownSellerRate, 0.075)
  assert.equal(midProjected.resolvedSyncShopKey, 'hetianyayu')
  assert.equal(midProjected.syncShopIdentitySource, 'platform_credential')
  assert.equal(midProjected.ownershipDegraded, false)

  // 5: 低比例不 degraded
  assert.equal(
    buildOwnershipSyncSummary({
      itemCount: 1000,
      matchedCount: 995,
      crossShopSkippedCount: 0,
      unknownSellerCount: 5,
      orderLevelUnknownSyncShopCount: 0,
      syncIdentity: ht,
    }).ownershipDegraded,
    false,
  )

  // 6: 高比例 degraded
  assert.equal(
    buildOwnershipSyncSummary({
      itemCount: 1000,
      matchedCount: 700,
      crossShopSkippedCount: 0,
      unknownSellerCount: 300,
      orderLevelUnknownSyncShopCount: 0,
      syncIdentity: ht,
    }).ownershipDegraded,
    true,
  )
  assert.equal(isUnknownSellerRateDegraded(300, 1000), true)

  // 7: itemCount=0
  const zero = buildOwnershipSyncSummary({
    itemCount: 0,
    matchedCount: 0,
    crossShopSkippedCount: 0,
    unknownSellerCount: 0,
    orderLevelUnknownSyncShopCount: 0,
    syncIdentity: ht,
  })
  assert.equal(zero.unknownSellerRate, 0)
  assert.equal(zero.unknownSyncShopCount, 0)
  assert.equal(Number.isFinite(zero.unknownSellerRate), true)
  assert.equal(computeUnknownSellerRate(10, 0), 0)

  // 8: syncOrderList 投影透传全部字段
  const full = buildOwnershipSyncSummary({
    itemCount: 10,
    matchedCount: 8,
    crossShopSkippedCount: 1,
    unknownSellerCount: 1,
    orderLevelUnknownSyncShopCount: 0,
    syncIdentity: ht,
  })
  const projected = projectSyncOrderListResult({
    total: 10,
    itemCount: 10,
    pageCount: 1,
    savedCount: 9,
    firstOrderId: null,
    firstPackageId: null,
    warnings: [],
    ...full,
  })
  for (const k of [
    'matchedCount',
    'crossShopSkippedCount',
    'unknownSellerCount',
    'unknownSellerRate',
    'unknownSyncShopCount',
    'resolvedSyncShopKey',
    'syncShopIdentitySource',
    'syncShopUnknown',
    'ownershipDegraded',
  ] as const) {
    assert.equal(projected[k], full[k], k)
  }

  // 9: 多账号任一 degraded
  const accounts = [
    buildOwnershipSyncSummary({
      itemCount: 10,
      matchedCount: 10,
      crossShopSkippedCount: 0,
      unknownSellerCount: 0,
      orderLevelUnknownSyncShopCount: 0,
      syncIdentity: ht,
    }),
    unk,
  ]
  const anyDegraded = accounts.some((a) => a.ownershipDegraded)
  assert.equal(anyDegraded, true)

  // 10: legacy + 名称 fallback 不误标
  const nameFb = resolveSyncShopIdentityFromFields({
    liveAccountId: 'legacy',
    liveAccountName: '祥钰珠宝',
  })
  const fb = buildOwnershipSyncSummary({
    itemCount: 50,
    matchedCount: 50,
    crossShopSkippedCount: 0,
    unknownSellerCount: 0,
    orderLevelUnknownSyncShopCount: 0,
    syncIdentity: nameFb,
  })
  assert.equal(nameFb.source, 'live_account_name')
  assert.equal(fb.syncShopUnknown, false)
  assert.equal(fb.ownershipDegraded, false)

  // warning 不刷屏
  const warnings: string[] = []
  appendOwnershipSyncWarnings(warnings, unk, 1000)
  appendOwnershipSyncWarnings(warnings, unk, 1000)
  assert.equal(warnings.filter((w) => w.includes('跨店保护已降级')).length, 1)

  assert.equal(emptyOwnershipSyncSummary().unknownSyncShopCount, 0)
  assert.equal(emptyOwnershipSyncSummary().syncShopUnknown, true)
  assert.equal(emptyOwnershipSyncSummary().ownershipDegraded, true)

  console.log('verify-ownership-sync-diagnostics: OK')
}

main()
