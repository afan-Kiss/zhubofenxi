/**
 * 只读：诊断 Prisma 迁移与 AnchorDailySchedule 临时主播字段状态
 * npx tsx apps/server/scripts/diagnose-prisma-migration-state.ts
 */
import path from 'node:path'
import fs from 'node:fs'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'

config({ path: path.resolve(__dirname, '../.env') })

type MigRow = {
  id: string
  migration_name: string
  started_at: string | null
  finished_at: string | null
  rolled_back_at: string | null
  logs: string | null
  applied_steps_count: number | null
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? 'file:../data/app.db'
  const prisma = new PrismaClient()
  try {
    console.log('diagnose-prisma-migration-state（只读）\n')
    console.log(`数据库路径: ${dbUrl}`)

    const migrationDirs = fs
      .readdirSync(path.resolve(__dirname, '../prisma/migrations'))
      .filter((n) => /^\d{14}_/.test(n))
      .sort()
    console.log(`Prisma migration 数量: ${migrationDirs.length}`)

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, migration_name, started_at, finished_at, rolled_back_at, logs, applied_steps_count
       FROM _prisma_migrations
       ORDER BY started_at ASC`,
    )) as MigRow[]

    const success = rows.filter((r) => r.finished_at && !r.rolled_back_at)
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at)
    const rolled = rows.filter((r) => r.rolled_back_at)
    const appliedNames = new Set(success.map((r) => r.migration_name))
    const pending = migrationDirs.filter((n) => !appliedNames.has(n))

    console.log(`已成功数量: ${success.length}`)
    console.log(`失败数量: ${failed.length}`)
    console.log(`已回滚数量: ${rolled.length}`)
    console.log(`未应用数量: ${pending.length}`)

    if (failed.length) {
      console.log('\n失败 migration：')
      for (const f of failed) {
        console.log(`- migration_name: ${f.migration_name}`)
        console.log(`  started_at: ${f.started_at}`)
        console.log(`  finished_at: ${f.finished_at}`)
        console.log(`  rolled_back_at: ${f.rolled_back_at}`)
        console.log(`  logs: ${f.logs ?? '(empty)'}`)
        console.log(`  applied_steps_count: ${f.applied_steps_count}`)
      }
    } else {
      console.log('\n失败 migration：无')
    }

    if (pending.length) {
      console.log('\n未应用 migration：')
      for (const p of pending) console.log(`- ${p}`)
    }

    const cols = (await prisma.$queryRawUnsafe(
      `PRAGMA table_info("AnchorDailySchedule")`,
    )) as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>
    const byName = new Map(cols.map((c) => [c.name, c]))
    console.log('\nAnchorDailySchedule 当前字段：')
    for (const name of ['isTemporaryAnchor', 'temporaryAnchorKey', 'anchorColorSnapshot']) {
      const c = byName.get(name)
      if (!c) {
        console.log(`- ${name}: MISSING`)
      } else {
        console.log(
          `- ${name}: type=${c.type} notnull=${c.notnull} default=${c.dflt_value ?? 'NULL'}`,
        )
      }
    }

    const indexes = (await prisma.$queryRawUnsafe(
      `PRAGMA index_list("AnchorDailySchedule")`,
    )) as Array<{ name: string; unique: number }>
    console.log('\n相关索引：')
    for (const idx of indexes) {
      const info = (await prisma.$queryRawUnsafe(
        `PRAGMA index_info("${idx.name}")`,
      )) as Array<{ name: string }>
      const fields = info.map((i) => i.name).join(', ')
      if (
        fields.includes('temporaryAnchorKey') ||
        idx.name.includes('temporary') ||
        idx.name.includes('Temporary')
      ) {
        console.log(`- ${idx.name}: [${fields}] unique=${idx.unique}`)
      }
    }
    const tempIdx = indexes.find((i) => i.name.includes('temporaryAnchorKey') || i.name.includes('Temporary'))
    if (!tempIdx) {
      console.log('- (未找到 temporaryAnchorKey 相关索引)')
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
