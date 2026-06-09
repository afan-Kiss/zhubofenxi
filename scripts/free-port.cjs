/**
 * 释放指定端口（开发时上次 Vite 未正常退出）
 * 用法: node scripts/free-port.cjs 5173
 */
const { execSync } = require('node:child_process')

const port = process.argv[2] || '5173'

function freePortWindows() {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
    const pids = new Set()
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && pid !== '0') pids.add(pid)
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
        console.log(`[free-port] 已结束占用 ${port} 的进程 PID ${pid}`)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* 无占用 */
  }
}

function freePortUnix() {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim()
    if (!out) return
    for (const pid of out.split('\n')) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
        console.log(`[free-port] 已结束占用 ${port} 的进程 PID ${pid}`)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* 无占用 */
  }
}

if (process.platform === 'win32') {
  freePortWindows()
} else {
  freePortUnix()
}
