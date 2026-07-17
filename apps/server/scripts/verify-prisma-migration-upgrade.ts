/**
 * 旧库升级：只部署到临时主播 migration 之前，插入历史数据，再 deploy 最新
 * 全程使用临时 prisma/migrations 副本，不移动仓库内真实 migration 目录
 * npm run verify:prisma-migration-upgrade
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const serverRoot = path.resolve(__dirname, '..')
const prismaRoot = path.join(serverRoot, 'prisma')
const migrationsSrc = path.join(prismaRoot, 'migrations')
const TEMP_CUTOFF = '20260717140000_anchor_daily_temporary_anchor'
const require = createRequire(__filename)

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd = serverRoot) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', shell: true })
  if (r.status !== 0) {
    console.error(r.stdout)
    console.error(r.stderr)
    throw new Error(`${cmd} ${args.join(' ')} failed (status=${r.status})`)
  }
  return r.stdout
}

function listMigrations(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((n) => /^\d{14}_/.test(n))
    .sort()
}

async function main() {
  console.log('verify:prisma-migration-upgrade\n')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhubo-migrate-upgrade-'))
  const dbPath = path.join(dir, 'upgrade.db')
  const dbUrl = `file:${dbPath.replace(/\\/g, '/')}`
  const tempPrisma = path.join(dir, 'prisma')
  const tempMigrations = path.join(tempPrisma, 'migrations')
  const tempSchema = path.join(tempPrisma, 'schema.prisma')

  try {
    fs.mkdirSync(tempMigrations, { recursive: true })
    fs.copyFileSync(path.join(prismaRoot, 'schema.prisma'), tempSchema)
    const migrationLock = path.join(migrationsSrc, 'migration_lock.toml')
    if (fs.existsSync(migrationLock)) {
      fs.copyFileSync(migrationLock, path.join(tempMigrations, 'migration_lock.toml'))
    }

    const all = listMigrations(migrationsSrc)
    const oldOnly = all.filter(
      (n) => n < TEMP_CUTOFF && !n.startsWith('20260717140100_'),
    )
    const newOnes = all.filter(
      (n) => n === TEMP_CUTOFF || n.startsWith('20260717140100_') || n > TEMP_CUTOFF,
    )

    for (const name of oldOnly) {
      const toDir = path.join(tempMigrations, name)
      fs.mkdirSync(toDir, { recursive: true })
      fs.copyFileSync(
        path.join(migrationsSrc, name, 'migration.sql'),
        path.join(toDir, 'migration.sql'),
      )
    }

    const env = {
      ...process.env,
      DATABASE_URL: dbUrl,
    }

    console.log(`临时库: ${dbUrl}`)
    console.log(`旧链迁移数: ${oldOnly.length}`)
    run('npx', ['prisma', 'migrate', 'deploy', '--schema', tempSchema], env)
    console.log('  ✓ 已部署临时主播之前的迁移')

    // 旧库尚无临时主播列：用 raw SQL 插入，避免当前 Prisma Client 写入新字段
    delete require.cache[require.resolve('@prisma/client')]
    const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client')
    let prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })

    const anchorId = 'upgrade-test-anchor-1'
    const scheduleId = 'upgrade-test-schedule-1'
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Anchor" ("id","name","color","enabled","attributionMode","effectiveFrom","sortOrder","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      anchorId,
      '__TEST_UPGRADE_ANCHOR__',
      '#123456',
      1,
      'schedule',
      '2026-06-01',
      99,
    )
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AnchorDailySchedule"
        ("id","scheduleDate","anchorId","anchorName","shopName","liveRoomName","startAt","endAt","source","enabled","locked","confirmed","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      scheduleId,
      '2026-07-10',
      anchorId,
      '__TEST_UPGRADE_ANCHOR__',
      '升级测试店',
      '升级测试店',
      '2026-07-10 01:00:00',
      '2026-07-10 08:00:00',
      'manual',
      1,
    )
    await prisma.$disconnect()

    for (const name of newOnes) {
      const toDir = path.join(tempMigrations, name)
      fs.mkdirSync(toDir, { recursive: true })
      fs.copyFileSync(
        path.join(migrationsSrc, name, 'migration.sql'),
        path.join(toDir, 'migration.sql'),
      )
    }

    run('npx', ['prisma', 'migrate', 'deploy', '--schema', tempSchema], env)
    // 不在此 generate：schema 与仓库一致，且 Windows 下临时 schema 会误触发 engine 文件锁
    console.log('  ✓ 最新 migrate deploy 成功')

    delete require.cache[require.resolve('@prisma/client')]
    const { PrismaClient: PrismaClient2 } = require('@prisma/client') as typeof import('@prisma/client')
    prisma = new PrismaClient2({ datasources: { db: { url: dbUrl } } })
    try {
      const stillAnchor = await prisma.anchor.findUnique({ where: { id: anchorId } })
      assert.ok(stillAnchor)
      assert.equal(stillAnchor!.name, '__TEST_UPGRADE_ANCHOR__')

      const stillSchedule = await prisma.anchorDailySchedule.findUnique({
        where: { id: scheduleId },
      })
      assert.ok(stillSchedule)
      assert.equal(stillSchedule!.anchorName, '__TEST_UPGRADE_ANCHOR__')
      assert.equal(stillSchedule!.isTemporaryAnchor, false)
      assert.equal(stillSchedule!.temporaryAnchorKey, null)
      console.log('  ✓ 历史主播/排班仍在，isTemporaryAnchor=false')

      const cols = (await prisma.$queryRawUnsafe(
        `PRAGMA table_info("AnchorDailySchedule")`,
      )) as Array<{ name: string }>
      for (const n of ['isTemporaryAnchor', 'temporaryAnchorKey', 'anchorColorSnapshot']) {
        assert.ok(cols.some((c) => c.name === n), `missing ${n}`)
      }
      console.log('  ✓ 新字段已增加且无数据丢失')
    } finally {
      await prisma.$disconnect()
    }

    console.log('\nPASS')
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
