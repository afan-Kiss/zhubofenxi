/**
 * 缓存指纹升级验收（静态）
 * npx tsx apps/server/scripts/verify-canonical-cache-invalidation.ts
 */
import assert from 'node:assert/strict'
import {
  BUSINESS_CACHE_FINGERPRINT,
  CANONICAL_ATTRIBUTION_VERSION,
} from '../src/services/business-cache-fingerprint'

function main() {
  console.log('verify-canonical-cache-invalidation')
  assert.match(
    CANONICAL_ATTRIBUTION_VERSION,
    /^canonical-v6-four-shop-date-aware-fallback-2026-07-27$/,
  )
  assert.ok(BUSINESS_CACHE_FINGERPRINT.includes(CANONICAL_ATTRIBUTION_VERSION))
  assert.ok(!BUSINESS_CACHE_FINGERPRINT.includes('canonical-v5-offboard-date-2026-07-19'))
  console.log(`  ✓ version=${CANONICAL_ATTRIBUTION_VERSION}`)
  console.log(`  ✓ fingerprint contains v6`)
  console.log('ALL PASS')
}

main()
