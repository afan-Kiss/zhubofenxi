/**
 * 线下录入成交时间默认值：跟随页面单日（今日/昨日），按上海时区解析提交。
 * npx tsx apps/server/scripts/verify-offline-deal-entry-date-default.ts
 */
import assert from 'node:assert/strict'
import {
  defaultOfflineDealAtInput,
  offlineDealAtToIso,
} from '../../web/src/lib/offline-deal-entry-time'

function main() {
  const now = new Date('2026-07-28T03:15:00.000Z') // 上海 11:15
  assert.equal(defaultOfflineDealAtInput(undefined, now), '2026-07-28T11:15')
  assert.equal(defaultOfflineDealAtInput('2026-07-27', now), '2026-07-27T11:15')
  assert.equal(defaultOfflineDealAtInput(' 2026-07-27 ', now), '2026-07-27T11:15')
  assert.equal(defaultOfflineDealAtInput('bad', now), '2026-07-28T11:15')

  const iso = offlineDealAtToIso('2026-07-27T11:15')
  assert.equal(iso, new Date('2026-07-27T11:15:00+08:00').toISOString())
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date(iso))
    .reduce(
      (acc, p) => {
        if (p.type === 'year' || p.type === 'month' || p.type === 'day') acc[p.type] = p.value
        return acc
      },
      {} as Record<string, string>,
    )
  assert.equal(`${dayKey.year}-${dayKey.month}-${dayKey.day}`, '2026-07-27')

  console.log('PASS: verify-offline-deal-entry-date-default')
}

main()
