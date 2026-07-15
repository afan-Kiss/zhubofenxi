/**
 * 经营缓存指纹验收：源数据 generation 变化时必须重建（Wave4 热路径用 generation）
 *
 * npm run verify:business-cache-fingerprint
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import {
  buildAndSetBusinessBoardCache,
  getOrBuildBusinessBoardCache,
  resolveSourceRawMaxUpdatedAt,
} from '../src/services/business-cache.service'
import {
  bumpBoardSourceGenerations,
  ensureBusinessDataGenerationLoaded,
} from '../src/services/business-data-generation.service'

config({ path: path.resolve(__dirname, '../.env') })

const START = process.env.START_DATE?.trim() || '2026-06-01'
const END = process.env.END_DATE?.trim() || '2026-06-07'

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string): void {
  console.error(`  ✗ FAIL: ${msg}`)
  process.exitCode = 1
}

async function main(): Promise<void> {
  console.log('verify-business-cache-fingerprint\n')
  await ensureBusinessDataGenerationLoaded()

  const entry1 = await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: START,
    endDate: END,
  })
  ok(`首次构建 sourceRawMaxUpdatedAt=${entry1.sourceRawMaxUpdatedAt ?? '—'}`)
  if (!entry1.dataGeneration) {
    fail('构建条目应写入 dataGeneration')
    return
  }

  const hit1 = await getOrBuildBusinessBoardCache({
    preset: 'custom',
    startDate: START,
    endDate: END,
  })
  if (hit1.lastBuiltAt !== entry1.lastBuiltAt) {
    fail('无变化时不应重建缓存')
    return
  }
  ok('无数据变化时缓存命中')

  const beforeSourceMax = entry1.sourceDataMaxTime
  const sample = await prisma.xhsRawOrder.findFirst({
    where: { orderTime: { not: null } },
    orderBy: { updatedAt: 'asc' },
    select: { id: true, updatedAt: true },
  })
  if (!sample) {
    console.log('⚠ 无订单数据，跳过 updatedAt 模拟')
    console.log('\nPASS')
    return
  }

  const beforeUpdatedAt = sample.updatedAt
  await prisma.xhsRawOrder.update({
    where: { id: sample.id },
    data: { updatedAt: new Date(Date.now() + 60_000) },
  })
  // Wave4：实质写入路径 bump generation（此处模拟订单源变更）
  await bumpBoardSourceGenerations()

  const latestRaw = await resolveSourceRawMaxUpdatedAt()
  if (latestRaw === entry1.sourceRawMaxUpdatedAt) {
    fail('更新订单 updatedAt 后 sourceRawMaxUpdatedAt 未变化')
    return
  }
  ok('更新订单 updatedAt 后源数据变化（MAX 验收兜底）')

  const entry2 = await getOrBuildBusinessBoardCache({
    preset: 'custom',
    startDate: START,
    endDate: END,
  })
  if (entry2.lastBuiltAt === entry1.lastBuiltAt) {
    fail('generation 变化后应重建缓存')
    return
  }
  ok('generation 变化后缓存已重建')

  const afterSourceMax =
    (await prisma.xhsRawOrder.aggregate({ _max: { orderTime: true } }))._max.orderTime?.toISOString() ??
    null
  if (beforeSourceMax !== afterSourceMax) {
    fail('模拟 updatedAt 变化不应改变 orderTime 最大值')
    return
  }
  ok('orderTime 最大值未变（仅源 generation 触发重建）')

  await prisma.xhsRawOrder.update({
    where: { id: sample.id },
    data: { updatedAt: beforeUpdatedAt },
  })
  ok('已恢复测试订单 updatedAt')

  if (!process.exitCode) console.log('\nPASS')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
