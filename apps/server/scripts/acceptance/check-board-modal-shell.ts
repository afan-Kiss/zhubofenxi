/**
 * 静态验收：业务明细弹窗壳不再使用右侧抽屉交互。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fail, pass, readText, repoPath, toRepoRelative, walkFiles } from './_shared'

const shell = readText(repoPath('apps/web/src/components/board/BoardDrawerShell.tsx'))
const modal = readText(repoPath('apps/web/src/components/ui/ViewportModal.tsx'))

if (shell.includes('justify-end')) {
  fail('BoardDrawerShell 仍包含 justify-end（右侧抽屉布局）')
}
pass('BoardDrawerShell 无 justify-end')

if (shell.includes('translate-x-full') || shell.includes('translate-x-0')) {
  fail('BoardDrawerShell 仍包含 translate-x 滑动动画')
}
pass('BoardDrawerShell 无 translate-x 滑动')

if (!shell.includes('closeOnBackdrop={false}')) {
  fail('BoardDrawerShell 未禁用遮罩关闭')
}
pass('BoardDrawerShell closeOnBackdrop=false')

if (!shell.includes('closeOnEscape={false}')) {
  fail('BoardDrawerShell 未禁用 Esc 关闭')
}
pass('BoardDrawerShell closeOnEscape=false')

if (!shell.includes('mobileFullscreen')) {
  fail('BoardDrawerShell 未启用 mobileFullscreen')
}
pass('BoardDrawerShell mobileFullscreen')

if (!shell.includes('aria-label="关闭弹窗"')) {
  fail('BoardDrawerShell 关闭按钮缺少 aria-label="关闭弹窗"')
}
pass('关闭按钮 aria-label')

if (!shell.includes('board-modal-content') || !shell.includes('overflow-y-auto')) {
  fail('BoardDrawerShell 缺少独立滚动内容区')
}
pass('内容区独立滚动')

if (!modal.includes('role="dialog"') || !modal.includes('aria-modal="true"')) {
  fail('ViewportModal 缺少 role=dialog / aria-modal')
}
pass('ViewportModal dialog/aria-modal')

if (!modal.includes('closeOnBackdrop')) {
  fail('ViewportModal 未实现 closeOnBackdrop')
}
pass('ViewportModal 遮罩受 closeOnBackdrop 控制')

const allowed = new Set([
  'apps/web/src/components/board/DailyReportImagePreview.tsx',
  'apps/web/src/components/board/DailyReportMobileUploadQr.tsx',
  'apps/web/src/components/boss/BossAnnouncementPopup.tsx',
])

const scanRoots = [
  repoPath('apps/web/src/components/board'),
  repoPath('apps/web/src/components/boss'),
  repoPath('apps/web/src/components/operations'),
  repoPath('apps/web/src/components/good-reviews'),
  repoPath('apps/web/src/components/refund-analysis'),
]

const leftover: string[] = []
for (const root of scanRoots) {
  for (const file of walkFiles(root, { extensions: ['.ts', '.tsx'] })) {
    const rel = toRepoRelative(file).replace(/\\/g, '/')
    if (allowed.has(rel)) continue
    const text = fs.readFileSync(file, 'utf8')
    const side =
      /fixed\s+inset-0[^"'`\n]*flex\s+justify-end/.test(text) ||
      text.includes('translate-x-full')
    if (side) leftover.push(rel)
  }
}

if (leftover.length > 0) {
  fail(`仍存在疑似侧边抽屉：\n${leftover.join('\n')}`)
}
pass('业务组件目录无遗留侧边抽屉布局')

console.log('[acceptance] OK: board modal shell 静态检查通过')
