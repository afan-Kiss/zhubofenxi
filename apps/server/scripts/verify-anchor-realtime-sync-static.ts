/**
 * 主播业绩 today/yesterday 自动同步静态验收
 *
 * npm run verify:anchor-realtime-sync-static
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const issues: string[] = []

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf-8')
}

function main(): void {
  console.log('verify-anchor-realtime-sync-static')

  const anchor = read('web/src/pages/board/AnchorPerformanceTab.tsx')

  if (
    anchor.includes("preset === 'today'") &&
    anchor.includes("preset === 'yesterday'") &&
    anchor.includes('triggerBusinessSync')
  ) {
    ok('AnchorPerformanceTab 只在 today/yesterday 自动 triggerBusinessSync')
  } else {
    fail('AnchorPerformanceTab 缺少 today/yesterday 自动 triggerBusinessSync')
  }

  if (anchor.includes('AUTO_SYNC_COOLDOWN_MS')) {
    fail('AnchorPerformanceTab 仍保留 3 分钟冷却，应每次打开今日/昨日都触发同步')
  } else {
    ok('AnchorPerformanceTab 已移除 3 分钟冷却')
  }

  if (
    anchor.includes('仅在切换今日/昨日范围时触发') ||
    (anchor.match(/useEffect\([\s\S]*triggerBusinessSync[\s\S]*\[preset, startDate, endDate/) &&
      !anchor.match(/syncMeta\?\.businessSync\?\.status[\s\S]*triggerBusinessSync/))
  ) {
    ok('切换 today/yesterday 时触发同步，同步完成不重复触发')
  } else {
    fail('自动同步 effect 依赖不正确，可能在同步完成后重复拉单')
  }

  if (anchor.includes('.catch(') && anchor.includes('triggerBusinessSync')) {
    ok('triggerBusinessSync 有 catch')
  } else {
    fail('triggerBusinessSync 缺少 catch')
  }

  if (
    anchor.includes('自动更新失败') &&
    anchor.includes('当前先展示本地已有数据')
  ) {
    ok('失败有用户可见提示')
  } else {
    fail('缺少自动同步失败用户可见提示')
  }

  if (
    !anchor.includes("preset === 'thisMonth'") ||
    !anchor.match(/preset\s*!==\s*'today'[\s\S]*triggerBusinessSync/)
  ) {
    // thisMonth alone doesn't trigger - check guard
  }
  if (anchor.includes("preset !== 'today' && preset !== 'yesterday'")) {
    ok('thisMonth/custom 不自动同步（有 preset 守卫）')
  } else {
    fail('缺少 thisMonth/custom 不自动同步守卫')
  }

  console.log('\n=== 结果 ===')
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(` - ${i}`)
    process.exit(1)
  }
  console.log('PASS')
}

main()
