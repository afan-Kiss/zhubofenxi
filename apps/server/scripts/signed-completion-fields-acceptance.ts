/**
 * 已签收下钻：官方状态原文 + 完成时间字段晋升 / 解析验收
 */
import assert from 'node:assert/strict'
import { ensureOrderRawCompletionFields } from '../src/services/order-raw-completion.util'
import { resolveSignedTimeFromRaw } from '../src/services/signed-order-sort.service'
import { normalizeXhsOrderPackage } from '../src/services/xhs-api-sync/xhs-json-normalizer.service'

function sampleCompletedPackage(): Record<string, unknown> {
  return {
    packageId: 'P799759259763371981',
    orderId: '799759259763371981',
    status: 7,
    statusDesc: '已完成',
    orderedAt: '2026-07-16 21:07:39',
    paidAt: '2026-07-16 21:07:41',
    // 官方完成时间常用别名（未晋升前不在 finishTime）
    finishedAt: '2026-07-19 11:08:04',
    sellerReceiveAmount: 817,
    totalPayAmount: 817,
    skuList: [{ skuName: '俄白大宽胎58.2', soldPrice: 799 }],
  }
}

function main() {
  const raw = sampleCompletedPackage()
  const promoted = ensureOrderRawCompletionFields(raw)
  assert.equal(promoted.statusDescPromoted, false, '已有官网 statusDesc 不覆盖')
  assert.equal(String(raw.statusDesc), '已完成')
  assert.equal(promoted.finishTimePromoted, true)
  assert.equal(String(raw.finishTime), '2026-07-19 11:08:04')

  const signed = resolveSignedTimeFromRaw(raw)
  assert.ok(signed.displayText?.includes('2026-07-19'))
  assert.ok(signed.displayText?.includes('11:08'))
  assert.equal(signed.source, 'finishTime')

  const normalized = normalizeXhsOrderPackage({ ...sampleCompletedPackage() }, 0)
  assert.equal(normalized.orderStatusText, '已完成')
  assert.equal(normalized.isSigned, true)

  // 仅有数字 status、无文案时：不编造「交易完成」
  const codeOnly: Record<string, unknown> = {
    status: 7,
    orderFinishTime: '2026-07-19 11:08:04',
  }
  const codePromoted = ensureOrderRawCompletionFields(codeOnly)
  assert.equal(codePromoted.statusDescPromoted, false)
  assert.equal(codeOnly.statusDesc, undefined)
  assert.equal(codePromoted.finishTimePromoted, true)

  // 已有官方文案时不覆盖
  const withDesc: Record<string, unknown> = {
    status: 7,
    statusDesc: '交易完成',
    finishTime: '2026-07-19 11:08:04',
  }
  const again = ensureOrderRawCompletionFields(withDesc)
  assert.equal(again.statusDescPromoted, false)
  assert.equal(again.finishTimePromoted, false)

  console.log('[signed-completion-fields-acceptance] OK')
}

main()
