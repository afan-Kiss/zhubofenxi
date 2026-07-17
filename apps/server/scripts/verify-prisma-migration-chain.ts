/**
 * 全新临时库：prisma migrate deploy 全链验收
 * npm run verify:prisma-migration-chain
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const serverRoot = path.resolve(__dirname, '..')
const require = createRequire(__filename)

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const r = spawnSync(cmd, args, {
    cwd: serverRoot,
    env,
    encoding: 'utf8',
    shell: true,
  })
  if (r.status !== 0) {
    console.error(r.stdout)
    console.error(r.stderr)
    throw new Error(`${cmd} ${args.join(' ')} failed: ${r.status}`)
  }
  return r.stdout
}

async function main() {
  console.log('verify:prisma-migration-chain\n')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhubo-migrate-chain-'))
  const dbPath = path.join(dir, 'chain.db')
  const dbUrl = `file:${dbPath.replace(/\\/g, '/')}`
  const env = { ...process.env, DATABASE_URL: dbUrl }

  try {
    console.log(`临时库: ${dbUrl}`)
    run('npx', ['prisma', 'migrate', 'deploy'], env)
    run('npx', ['prisma', 'generate'], env)
    console.log('  ✓ migrate deploy + generate')

    // Use a fresh PrismaClient against temp DB
    delete require.cache[require.resolve('@prisma/client')]
    const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
    try {
      const cols = (await prisma.$queryRawUnsafe(
        `PRAGMA table_info("AnchorDailySchedule")`,
      )) as Array<{ name: string; notnull: number; dflt_value: string | null }>
      const by = new Map(cols.map((c) => [c.name, c]))
      for (const name of ['isTemporaryAnchor', 'temporaryAnchorKey', 'anchorColorSnapshot']) {
        assert.ok(by.has(name), `missing ${name}`)
      }
      assert.equal(Number(by.get('isTemporaryAnchor')!.notnull), 1)
      assert.ok(
        String(by.get('isTemporaryAnchor')!.dflt_value ?? '').includes('0'),
        'default false/0',
      )
      console.log('  ✓ AnchorDailySchedule 临时字段存在且默认值正确')

      const idx = (await prisma.$queryRawUnsafe(
        `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
        'AnchorDailySchedule_scheduleDate_temporaryAnchorKey_idx',
      )) as Array<{ name: string }>
      assert.equal(idx.length, 1)
      console.log('  ✓ temporaryAnchorKey 索引存在')

      const normal = await prisma.anchorDailySchedule.create({
        data: {
          scheduleDate: '2026-07-10',
          anchorName: '__TEST_CHAIN_NORMAL__',
          shopName: '测试店',
          liveRoomName: '测试店',
          startAt: new Date('2026-07-10T01:00:00.000Z'),
          endAt: new Date('2026-07-10T05:00:00.000Z'),
          source: 'manual',
          enabled: true,
          isTemporaryAnchor: false,
        },
      })
      assert.equal(normal.isTemporaryAnchor, false)
      console.log('  ✓ 普通排班 isTemporaryAnchor=false')

      const temp = await prisma.anchorDailySchedule.create({
        data: {
          scheduleDate: '2026-07-10',
          anchorName: '__TEST_CHAIN_TEMP__',
          shopName: '测试店',
          liveRoomName: '测试店',
          startAt: new Date('2026-07-10T06:00:00.000Z'),
          endAt: new Date('2026-07-10T10:00:00.000Z'),
          source: 'manual',
          enabled: true,
          isTemporaryAnchor: true,
          temporaryAnchorKey: 'temp:2026-07-10:chain',
          anchorColorSnapshot: '#112233',
        },
      })
      assert.equal(temp.isTemporaryAnchor, true)
      assert.equal(temp.temporaryAnchorKey, 'temp:2026-07-10:chain')
      assert.equal(temp.anchorColorSnapshot, '#112233')
      console.log('  ✓ 临时主播字段可读写')
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
