import fs from 'node:fs'
import path from 'node:path'

/** 仓库根目录：apps/server/scripts/acceptance → 上四级 */
export const REPO_ROOT = path.resolve(__dirname, '../../../..')

export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments)
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8')
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath)
}

export function walkFiles(
  rootDir: string,
  options?: { extensions?: string[]; skipDirNames?: Set<string> },
): string[] {
  const extensions = options?.extensions ?? ['.ts', '.tsx', '.js', '.jsx']
  const skipDirNames = options?.skipDirNames ?? new Set(['node_modules', 'dist', '.git'])
  const results: string[] = []

  if (!fs.existsSync(rootDir)) return results

  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!skipDirNames.has(entry.name)) stack.push(full)
        continue
      }
      const ext = path.extname(entry.name)
      if (extensions.includes(ext)) results.push(full)
    }
  }
  return results
}

export function toRepoRelative(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/')
}

export function fail(message: string, details?: string[]): never {
  console.error(`\n[acceptance] FAIL: ${message}`)
  if (details?.length) {
    for (const line of details) console.error(`  - ${line}`)
  }
  process.exit(1)
}

export function pass(message: string): void {
  console.log(`[acceptance] OK: ${message}`)
}

export function loadJson<T>(filePath: string): T {
  return JSON.parse(readText(filePath)) as T
}
