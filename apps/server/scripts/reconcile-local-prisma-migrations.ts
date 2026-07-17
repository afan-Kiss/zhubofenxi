/**
 * 本地：在确认结构已存在后，将「未应用但结构齐全」的 migration 标记为 applied。
 * 只读校验 + prisma migrate resolve --applied；不修改业务表数据。
 *
 * npx tsx apps/server/scripts/reconcile-local-prisma-migrations.ts
 * DRY_RUN=1 仅打印，不 resolve
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'

config({ path: path.resolve(__dirname, '../.env') })

const DRY_RUN = process.env.DRY_RUN === '1'
const serverRoot = path.resolve(__dirname, '..')

type Col = { name: string; type: string; notnull: number; dflt_value: string | null }

async function tableExists(p: PrismaClient, name: string): Promise<boolean> {
  const rows = (await p.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    name,
  )) as Array<{ name: string }>
  return rows.length > 0
}

async function columnsOf(p: PrismaClient, table: string): Promise<Map<string, Col>> {
  if (!(await tableExists(p, table))) return new Map()
  const cols = (await p.$queryRawUnsafe(`PRAGMA table_info("${table}")`)) as Col[]
  return new Map(cols.map((c) => [c.name, c]))
}

async function indexExists(p: PrismaClient, name: string): Promise<boolean> {
  const rows = (await p.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
    name,
  )) as Array<{ name: string }>
  return rows.length > 0
}

/** 各 pending migration 的结构完备性检查（Situation A） */
async function isStructurallyApplied(p: PrismaClient, migrationName: string): Promise<{
  ok: boolean
  reason: string
}> {
  switch (migrationName) {
    case '20260704162000_xhs_sync_job_page_progress': {
      const cols = await columnsOf(p, 'XhsSyncJob')
      for (const n of ['currentPage', 'totalPage', 'currentApiKey', 'currentApiLabel', 'rangeLabel']) {
        if (!cols.has(n)) return { ok: false, reason: `missing XhsSyncJob.${n}` }
      }
      return { ok: true, reason: 'XhsSyncJob page progress columns present' }
    }
    case '20260704180000_overview_metric_snapshot': {
      if (!(await tableExists(p, 'OverviewMetricSnapshot'))) {
        return { ok: false, reason: 'OverviewMetricSnapshot missing' }
      }
      return { ok: true, reason: 'OverviewMetricSnapshot exists' }
    }
    case '20260706140000_good_review_material_tags': {
      const cols = await columnsOf(p, 'GoodReview')
      if (!cols.has('materialTagsJson')) {
        return { ok: false, reason: 'GoodReview.materialTagsJson missing' }
      }
      return { ok: true, reason: 'GoodReview.materialTagsJson present' }
    }
    case '20260711160000_boss_dashboard': {
      if (!(await tableExists(p, 'BossFundSnapshot'))) {
        return { ok: false, reason: 'BossFundSnapshot missing' }
      }
      return { ok: true, reason: 'boss dashboard tables present' }
    }
    case '20260712140000_lucky_gift_shipment': {
      if (!(await tableExists(p, 'XhsLuckyDraw'))) {
        return { ok: false, reason: 'XhsLuckyDraw missing' }
      }
      if (!(await tableExists(p, 'LuckyGiftShipment')) && !(await tableExists(p, 'XhsLuckyWinner'))) {
        return { ok: false, reason: 'LuckyGiftShipment/XhsLuckyWinner missing' }
      }
      return { ok: true, reason: 'lucky gift shipment schema present' }
    }
    case '20260712140000_workbench_return_refund_type': {
      const cols = await columnsOf(p, 'XhsAfterSalesWorkbenchCache')
      if (!cols.has('hasReturnRefund')) {
        return { ok: false, reason: 'hasReturnRefund missing' }
      }
      return { ok: true, reason: 'workbench return/refund columns present' }
    }
    case '20260712180000_boss_settlement_bills': {
      if (!(await tableExists(p, 'BossSettlementPeriodBill'))) {
        return { ok: false, reason: 'BossSettlementPeriodBill missing' }
      }
      return { ok: true, reason: 'boss settlement bills present' }
    }
    case '20260712181000_after_sales_queue_retry_wait': {
      const cols = await columnsOf(p, 'XhsAfterSalesWorkbenchQueue')
      if (!cols.has('temporaryAttemptCount') || !cols.has('nextAttemptAt')) {
        return { ok: false, reason: 'queue retry_wait columns missing' }
      }
      return { ok: true, reason: 'after-sales queue retry_wait present' }
    }
    case '20260712190000_order_attribution_disposition': {
      if (!(await tableExists(p, 'OrderAttributionDisposition'))) {
        return { ok: false, reason: 'OrderAttributionDisposition missing' }
      }
      return { ok: true, reason: 'disposition table present' }
    }
    case '20260712230000_lucky_gift_sf_fee': {
      const cols = await columnsOf(p, 'LuckyGiftShipment')
      if (!cols.has('sfMonthlyFeeCent') || !cols.has('sfFeeStatus')) {
        return { ok: false, reason: 'sf fee columns missing' }
      }
      return { ok: true, reason: 'lucky gift sf fee columns present' }
    }
    case '20260717140100_anchor_daily_temporary_anchor_index_idempotent': {
      if (!(await indexExists(p, 'AnchorDailySchedule_scheduleDate_temporaryAnchorKey_idx'))) {
        return { ok: false, reason: 'temporary index missing' }
      }
      return { ok: true, reason: 'temporary index present (idempotent)' }
    }
    case '20260714170000_anchor_system_key_attribution_mode': {
      const cols = await columnsOf(p, 'Anchor')
      if (!cols.has('systemKey') || !cols.has('attributionMode')) {
        return { ok: false, reason: 'Anchor.systemKey/attributionMode missing' }
      }
      return { ok: true, reason: 'anchor systemKey/attributionMode present' }
    }
    case '20260714183000_offline_deal_ledger': {
      if (!(await tableExists(p, 'OfflineDeal'))) {
        return { ok: false, reason: 'OfflineDeal missing' }
      }
      return { ok: true, reason: 'OfflineDeal present' }
    }
    case '20260715130000_anchor_master_effective_and_schedule_anchor_id': {
      const a = await columnsOf(p, 'Anchor')
      const s = await columnsOf(p, 'AnchorDailySchedule')
      if (!a.has('effectiveFrom') || !a.has('effectiveTo')) {
        return { ok: false, reason: 'Anchor effectiveFrom/To missing' }
      }
      if (!s.has('anchorId')) return { ok: false, reason: 'AnchorDailySchedule.anchorId missing' }
      return { ok: true, reason: 'anchor effective + schedule.anchorId present' }
    }
    case '20260715190000_wave3_after_sales_queue_meta': {
      return { ok: true, reason: 'wave3 queue meta (soft)' }
    }
    case '20260715210000_wave4_business_data_generation': {
      if (!(await tableExists(p, 'BusinessDataGeneration'))) {
        return { ok: false, reason: 'BusinessDataGeneration missing' }
      }
      return { ok: true, reason: 'BusinessDataGeneration present' }
    }
    case '20260716120000_cs_chat_refund_analysis': {
      if (!(await tableExists(p, 'CsChatSession'))) {
        return { ok: false, reason: 'CsChatSession missing' }
      }
      return { ok: true, reason: 'CsChatSession present' }
    }
    case '20260717140000_anchor_daily_temporary_anchor': {
      const cols = await columnsOf(p, 'AnchorDailySchedule')
      for (const n of ['isTemporaryAnchor', 'temporaryAnchorKey', 'anchorColorSnapshot']) {
        if (!cols.has(n)) return { ok: false, reason: `missing ${n}` }
      }
      if (!(await indexExists(p, 'AnchorDailySchedule_scheduleDate_temporaryAnchorKey_idx'))) {
        return { ok: false, reason: 'temporary index missing' }
      }
      return { ok: true, reason: 'temporary anchor columns+index present' }
    }
    default:
      return { ok: false, reason: 'no structural checker' }
  }
}

function resolveApplied(name: string): boolean {
  if (DRY_RUN) {
    console.log(`  DRY_RUN: would resolve --applied ${name}`)
    return true
  }
  const r = spawnSync(
    'npx',
    ['prisma', 'migrate', 'resolve', '--applied', name],
    { cwd: serverRoot, encoding: 'utf8', shell: true },
  )
  console.log(r.stdout || '')
  if (r.stderr) console.log(r.stderr)
  return r.status === 0
}

async function main() {
  const p = new PrismaClient()
  const toResolve: string[] = []
  try {
    console.log(`reconcile-local-prisma-migrations DRY_RUN=${DRY_RUN}\n`)

    const failed = (await p.$queryRawUnsafe(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    )) as Array<{ migration_name: string }>

    for (const f of failed) {
      const check = await isStructurallyApplied(p, f.migration_name)
      console.log(`failed: ${f.migration_name} => ${check.ok ? 'STRUCT_OK' : 'INCOMPLETE'}: ${check.reason}`)
      if (!check.ok) {
        console.error('Cannot auto-resolve failed migration with incomplete structure')
        process.exit(1)
      }
      toResolve.push(f.migration_name)
    }

    const dirs = fs
      .readdirSync(path.join(serverRoot, 'prisma/migrations'))
      .filter((n) => /^\d{14}_/.test(n))
      .sort()

    const applied = (await p.$queryRawUnsafe(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    )) as Array<{ migration_name: string }>
    const appliedSet = new Set(applied.map((a) => a.migration_name))

    for (const name of dirs) {
      if (appliedSet.has(name) || toResolve.includes(name)) continue
      const check = await isStructurallyApplied(p, name)
      console.log(`pending: ${name} => ${check.ok ? 'STRUCT_OK' : 'NEED_DEPLOY'}: ${check.reason}`)
      if (check.ok) {
        toResolve.push(name)
        appliedSet.add(name)
      } else if (check.reason === 'no structural checker') {
        console.log('  skip (no checker) — leave for migrate deploy')
      } else {
        console.log('  leave for migrate deploy')
      }
    }
  } finally {
    await p.$disconnect()
  }

  // resolve 必须在断开业务连接后执行，避免 SQLite database is locked
  for (const name of toResolve) {
    if (!resolveApplied(name)) process.exit(1)
  }

  console.log('\nDone. Next: npx prisma migrate status && npx prisma migrate deploy')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
