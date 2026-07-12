import type { BuyerProfileData } from './buyer-profile'

import type { BoardSyncMeta } from './board-live-query'
import { isBuyerProfileDataCacheCompatible } from './buyer-profile-cache'



/** 买家画像重建超过此时间视为可能卡住 */

export const BUYER_PROFILE_STUCK_MS = 30 * 60 * 1000



export type BuyerRankingUiState =

  | 'loading'

  | 'ready'

  | 'building'

  | 'stuck'

  | 'empty'

  | 'failed'



export type BuyerRankingHeaderHint =

  | 'none'

  | 'last_updated'

  | 'rebuilding_with_cache'

  | 'business_sync_light'



export type BuyerRankingMainCardVariant = 'rebuilding' | 'stuck' | 'empty' | 'failed' | null



export function isBuyerProfileCacheCompatible(

  profile: BuyerProfileData | null | undefined,

): boolean {

  return isBuyerProfileDataCacheCompatible(profile)

}



function profileHasReadableRankingData(
  profile: BuyerProfileData | null | undefined,
): boolean {
  if (!profile) return false
  if ((profile.items?.length ?? 0) > 0) return true
  if ((profile.buyerCount ?? 0) > 0) return true
  if ((profile.summary?.highValueCount ?? 0) > 0) return true
  if ((profile.summary?.repurchaseCount ?? 0) > 0) return true
  if ((profile.summary?.refundCount ?? 0) > 0) return true
  if ((profile.summary?.qualityHeavyCount ?? 0) > 0) return true
  return false
}

/** 是否允许展示买家排行列表与 summary（重建中仍展示已有缓存） */
export function shouldShowBuyerRankingItems(
  profile: BuyerProfileData | null | undefined,
  buyerProfileStatus?: BoardSyncMeta['buyerProfileStatus'] | null,
): boolean {
  if (!hasBuyerProfileCache(profile)) return false

  const hasReadable = profileHasReadableRankingData(profile)

  if (buyerProfileStatus?.status === 'stale_with_cache' && hasReadable) return true
  if (profile?.cacheStale && hasReadable) return true

  if (!isBuyerProfileCacheCompatible(profile)) {
    return hasReadable
  }

  if (buyerProfileStatus?.cacheCompatible === false) {
    return hasReadable
  }

  if (
    buyerProfileStatus?.expectedCacheVersion &&
    buyerProfileStatus.cacheVersion &&
    buyerProfileStatus.cacheVersion !== buyerProfileStatus.expectedCacheVersion
  ) {
    return hasReadable
  }

  return true
}



/** 是否有可展示的旧/新买家画像数据（版本 stale 时仍可读） */
export function hasBuyerProfileCache(profile: BuyerProfileData | null | undefined): boolean {

  if (!profile) return false

  if ((profile.items?.length ?? 0) > 0) return true

  if ((profile.buyerCount ?? 0) > 0) return true

  if (profile.updatedAt || profile.builtAt) return true

  return false

}



function mapApiStatus(status?: string): BuyerRankingUiState | null {

  switch (status) {

    case 'ready':

      return 'ready'

    case 'stale_with_cache':

    case 'rebuilding':

    case 'building':

      return 'building'

    case 'stale':

      return 'stuck'

    case 'failed':

    case 'error':

      return 'failed'

    case 'empty':

      return 'empty'

    default:

      return null

  }

}



function parseTimeMs(iso: string | null | undefined): number | null {

  if (!iso) return null

  const t = Date.parse(iso)

  return Number.isFinite(t) ? t : null

}



export function isBuyerProfileRebuildStuck(input: {

  buyerProfileStatus?: BoardSyncMeta['buyerProfileStatus'] | null

  profile?: BuyerProfileData | null

}): boolean {

  const status = input.buyerProfileStatus

  if (status?.status === 'stale' || status?.isStaleRunning) return true



  const rebuilding =

    status?.rebuilding === true ||

    status?.status === 'rebuilding' ||

    status?.status === 'building' ||

    input.profile?.rebuilding === true



  if (!rebuilding) return false



  const durationMs =

    status?.durationMs ??

    (status?.runningSeconds != null ? status.runningSeconds * 1000 : null)

  if (durationMs != null && durationMs >= BUYER_PROFILE_STUCK_MS) return true



  const refMs =

    parseTimeMs(status?.startedAt) ??

    parseTimeMs(status?.updatedAt) ??

    parseTimeMs(input.profile?.updatedAt)



  if (refMs == null) return false

  return Date.now() - refMs >= BUYER_PROFILE_STUCK_MS

}



export function deriveBuyerRankingUiState(input: {

  loading: boolean

  profile: BuyerProfileData | null

  error: string | null

  buyerProfileStatus?: BoardSyncMeta['buyerProfileStatus'] | null

  refreshBusy?: boolean

}): BuyerRankingUiState {

  if (input.loading && !input.profile) return 'loading'



  const apiState = mapApiStatus(input.buyerProfileStatus?.status)

  const cacheCompatible = isBuyerProfileCacheCompatible(input.profile)

  const hasCache = hasBuyerProfileCache(input.profile)

  const stuck = isBuyerProfileRebuildStuck({

    buyerProfileStatus: input.buyerProfileStatus,

    profile: input.profile,

  })



  if (stuck) return 'stuck'



  const apiRebuilding =

    input.buyerProfileStatus?.rebuilding === true ||

    apiState === 'building' ||

    input.profile?.rebuilding === true



  if (input.refreshBusy || apiRebuilding) {

    return hasCache ? 'building' : 'building'

  }



  if (apiState === 'failed') return 'failed'

  if (apiState === 'empty' && !hasCache) return 'empty'

  if (apiState === 'ready' && hasCache && cacheCompatible) return 'ready'

  if (hasCache && cacheCompatible) return 'ready'



  if (input.error && !input.profile) return 'failed'

  return 'empty'

}



export function resolveBuyerRankingHeaderHint(input: {

  uiState: BuyerRankingUiState

  hasCache: boolean

  isBusinessSyncing: boolean

  isProfileRebuilding: boolean

}): BuyerRankingHeaderHint {

  if (input.uiState === 'stuck' || input.uiState === 'failed' || input.uiState === 'empty') {
    return 'none'
  }

  if (input.uiState === 'building' && input.hasCache) return 'rebuilding_with_cache'

  if (
    input.isBusinessSyncing &&
    input.hasCache &&
    !input.isProfileRebuilding &&
    input.uiState === 'ready'
  ) {
    return 'business_sync_light'
  }

  if (input.uiState === 'ready' || (input.hasCache && input.uiState !== 'loading')) {
    return 'last_updated'
  }

  return 'none'

}



export function resolveBuyerRankingMainCard(
  uiState: BuyerRankingUiState,
  hasCache: boolean,
  opts?: { usesStandaloneRankingApi?: boolean },
): BuyerRankingMainCardVariant {
  if (opts?.usesStandaloneRankingApi) return null

  if (uiState === 'stuck') return 'stuck'

  if (uiState === 'failed') return 'failed'

  if (uiState === 'empty') return 'empty'

  if (uiState === 'building' && !hasCache) return 'rebuilding'

  return null
}



/** @deprecated 使用 resolveBuyerRankingMainCard */

export function resolveBuyerProgressCardVariant(

  uiState: BuyerRankingUiState,

  hasCache: boolean,

): BuyerRankingMainCardVariant {

  return resolveBuyerRankingMainCard(uiState, hasCache)

}



export function shouldAutoRebuildBuyerProfile(

  profile: BuyerProfileData | null | undefined,

  buyerProfileStatus?: BoardSyncMeta['buyerProfileStatus'] | null,

): boolean {

  if (buyerProfileStatus?.rebuilding) return false

  if (profile?.rebuilding) return false

  if (!profile && buyerProfileStatus?.rebuildScheduled) return true

  if (!profile) return false

  if (profile.cacheCompatible === false) return true

  if (profile.cacheStale) return true

  if (

    profile.expectedCacheVersion &&

    profile.cacheVersion &&

    profile.cacheVersion !== profile.expectedCacheVersion

  ) {

    return true

  }

  if (buyerProfileStatus?.rebuildScheduled && buyerProfileStatus.cacheCompatible === false) {

    return true

  }

  return false

}


