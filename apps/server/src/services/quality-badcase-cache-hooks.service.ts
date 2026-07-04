/** 品退数据变更后触发经营总览缓存重建（动态 import 避免循环依赖） */
export async function rebuildBusinessBoardCacheAfterQualityDataChange(
  reason: string,
): Promise<void> {
  const { invalidateAndRebuildBusinessBoardCache } = await import('./business-cache.service')
  await invalidateAndRebuildBusinessBoardCache(reason)
}
