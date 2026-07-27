/**
 * 修正橙橙生命周期：仅 2026-07-17 试播日；并保证小白有效区间覆盖 7.1。
 * npx tsx apps/server/scripts/repair-chengcheng-trial-lifecycle.ts [--dry-run]
 */
import { prisma } from '../src/lib/prisma'
import { refreshAnchorConfigCache } from '../src/services/anchor.service'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const chengcheng = await prisma.anchor.findFirst({ where: { name: '橙橙' } })
  const xiaobai = await prisma.anchor.findFirst({ where: { name: '小白' } })

  console.log('[repair-chengcheng] before', {
    橙橙: chengcheng
      ? {
          id: chengcheng.id,
          enabled: chengcheng.enabled,
          effectiveFrom: chengcheng.effectiveFrom,
          effectiveTo: chengcheng.effectiveTo,
          deletedAt: chengcheng.deletedAt,
          attributionMode: chengcheng.attributionMode,
        }
      : null,
    小白: xiaobai
      ? {
          id: xiaobai.id,
          enabled: xiaobai.enabled,
          effectiveFrom: xiaobai.effectiveFrom,
          effectiveTo: xiaobai.effectiveTo,
          attributionMode: xiaobai.attributionMode,
        }
      : null,
  })

  if (!dryRun && chengcheng) {
    await prisma.anchor.update({
      where: { id: chengcheng.id },
      data: {
        effectiveFrom: '2026-07-17',
        effectiveTo: '2026-07-17',
        enabled: false,
        attributionMode: 'schedule',
        // 离职模型：软删日 = 试播次日，历史日仍可归因
        deletedAt: chengcheng.deletedAt ?? new Date('2026-07-18T00:00:00+08:00'),
      },
    })
  }

  if (!dryRun && xiaobai) {
    const from = (xiaobai.effectiveFrom ?? '').trim()
    const needFrom =
      !from || from > '2026-07-01' ? '2026-06-18' : xiaobai.effectiveFrom
    await prisma.anchor.update({
      where: { id: xiaobai.id },
      data: {
        effectiveFrom: needFrom,
        effectiveTo: null,
        enabled: true,
        deletedAt: null,
        attributionMode: 'schedule',
      },
    })
  }

  if (!dryRun) await refreshAnchorConfigCache()

  const afterCc = await prisma.anchor.findFirst({ where: { name: '橙橙' } })
  const afterXb = await prisma.anchor.findFirst({ where: { name: '小白' } })
  console.log('[repair-chengcheng] after', {
    dryRun,
    橙橙: afterCc
      ? {
          enabled: afterCc.enabled,
          effectiveFrom: afterCc.effectiveFrom,
          effectiveTo: afterCc.effectiveTo,
          deletedAt: afterCc.deletedAt,
        }
      : null,
    小白: afterXb
      ? {
          enabled: afterXb.enabled,
          effectiveFrom: afterXb.effectiveFrom,
          effectiveTo: afterXb.effectiveTo,
          attributionMode: afterXb.attributionMode,
        }
      : null,
  })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
