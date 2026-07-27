/**
 * 排班硬校验：同店冲突 / 疑似互换禁止确认 / 模板偏离警告
 * npm run verify:schedule-hard-validation
 *
 * 正式长期模板（7.1）：子杰·拾玉早场 / 小白·和田早场 / 飞云·拾玉晚场
 * （小小·XY 早场自 7.16 起生效，本脚本用 7.08 不覆盖）
 */
import assert from 'node:assert/strict'
import {
  detectTemplateAnchorSwap,
  validateScheduleHardRules,
} from '../src/utils/schedule-hard-validation.util'

const DATE = '2026-07-08'

function templateOk() {
  return [
    { anchorName: '子杰', shopName: '拾玉居和田玉', liveRoomName: '拾玉居和田玉', startTime: '09:30', endTime: '14:00' },
    { anchorName: '小白', shopName: '和田雅玉', liveRoomName: '和田雅玉', startTime: '09:30', endTime: '14:00' },
    { anchorName: '飞云', shopName: '拾玉居和田玉', liveRoomName: '拾玉居和田玉', startTime: '18:30', endTime: '23:00' },
  ]
}

function main() {
  const ok = validateScheduleHardRules({ date: DATE, schedules: templateOk(), forConfirm: true })
  assert.equal(ok.ok, true)
  assert.ok(ok.confirmPreviewLines.some((l) => l.includes('和田雅玉') && l.includes('小白')))

  const swapped = templateOk().map((r) => {
    if (r.shopName === '和田雅玉' && r.startTime === '09:30') return { ...r, anchorName: '子杰' }
    if (r.shopName === '拾玉居和田玉' && r.startTime === '09:30') return { ...r, anchorName: '小白' }
    return r
  })
  const swap = detectTemplateAnchorSwap(DATE, swapped)
  assert.ok(swap, '应检出疑似互换')
  const blocked = validateScheduleHardRules({ date: DATE, schedules: swapped, forConfirm: true })
  assert.equal(blocked.ok, false)
  assert.ok(blocked.conflicts.some((c) => c.type === 'template_swap'))

  const warnOnly = validateScheduleHardRules({ date: DATE, schedules: swapped, forConfirm: false })
  assert.equal(warnOnly.ok, true)
  assert.ok(warnOnly.warnings.some((w) => w.includes('互换') || w.includes('模板')))

  const multiShopSameAnchor = [
    { anchorName: '小白', shopName: '和田雅玉', liveRoomName: '和田雅玉', startTime: '09:30', endTime: '14:00' },
    { anchorName: '小白', shopName: 'XY祥钰珠宝', liveRoomName: 'XY祥钰珠宝', startTime: '14:00', endTime: '18:30' },
  ]
  const cross = validateScheduleHardRules({
    date: DATE,
    schedules: multiShopSameAnchor,
    forConfirm: true,
  })
  assert.equal(cross.ok, false)

  const crossAllowed = validateScheduleHardRules({
    date: DATE,
    schedules: multiShopSameAnchor,
    allowCrossShopOverlap: true,
    changeReason: '临时代班测试',
    forConfirm: true,
  })
  assert.equal(crossAllowed.ok, true)

  console.log('PASS: schedule hard validation')
}

main()
