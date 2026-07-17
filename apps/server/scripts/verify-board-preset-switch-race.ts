/**
 * 快速切换 preset：仅最新请求可更新 UI；abort 不设 failed
 * npx tsx apps/server/scripts/verify-board-preset-switch-race.ts
 */
import assert from 'node:assert/strict'

type UiState = {
  rangeKey: string | null
  status: 'loading' | 'ready' | 'failed'
  error: string | null
}

function applyResponse(params: {
  ui: UiState
  responseRangeKey: string
  currentRangeKey: string
  requestSeq: number
  latestRequestSeq: number
  aborted: boolean
  ok: boolean
}): UiState {
  if (params.aborted || params.requestSeq !== params.latestRequestSeq) {
    return params.ui
  }
  if (params.responseRangeKey !== params.currentRangeKey) {
    return params.ui
  }
  if (!params.ok) {
    return { ...params.ui, status: 'failed', error: 'load failed' }
  }
  return {
    rangeKey: params.responseRangeKey,
    status: 'ready',
    error: null,
  }
}

function main() {
  console.log('verify-board-preset-switch-race\n')

  let ui: UiState = { rangeKey: null, status: 'loading', error: null }
  let latest = 0

  // today -> yesterday -> today
  latest = 1
  ui = applyResponse({
    ui,
    responseRangeKey: 'today|d',
    currentRangeKey: 'today|d',
    requestSeq: 1,
    latestRequestSeq: latest,
    aborted: false,
    ok: true,
  })
  assert.equal(ui.rangeKey, 'today|d')

  latest = 2
  // 旧 today 响应迟到且已 abort
  ui = applyResponse({
    ui,
    responseRangeKey: 'today|d',
    currentRangeKey: 'yesterday|y',
    requestSeq: 1,
    latestRequestSeq: latest,
    aborted: true,
    ok: false,
  })
  assert.equal(ui.status, 'ready')
  assert.equal(ui.error, null)
  console.log('  ✓ abort 请求不会把页面设为 failed')

  latest = 3
  ui = applyResponse({
    ui: { ...ui, status: 'loading' },
    responseRangeKey: 'yesterday|y',
    currentRangeKey: 'today|d',
    requestSeq: 2,
    latestRequestSeq: latest,
    aborted: false,
    ok: true,
  })
  assert.notEqual(ui.rangeKey, 'yesterday|y')
  console.log('  ✓ 旧范围响应不能覆盖新范围')

  ui = applyResponse({
    ui,
    responseRangeKey: 'today|d',
    currentRangeKey: 'today|d',
    requestSeq: 3,
    latestRequestSeq: latest,
    aborted: false,
    ok: true,
  })
  assert.equal(ui.rangeKey, 'today|d')
  assert.equal(ui.status, 'ready')
  console.log('  ✓ 只有最后一个请求可更新 UI')

  console.log('\nPASS')
}

main()
