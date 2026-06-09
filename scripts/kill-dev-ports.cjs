/**
 * 开发前释放 Vite 端口（默认 5173），兼容 Windows / macOS / Linux
 * 无进程占用时不报错、不输出错误
 */
const { execSync } = require('node:child_process')

const PORT = process.argv[2] || '5173'

function killOnWindows(port) {
  const pids = new Set()

  try {
    const out = execSync(`netstat -ano | findstr :${port}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })

    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed.includes('LISTENING')) continue
      const parts = trimmed.split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        pids.add(pid)
      }
    }
  } catch {
    return
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
      console.log(`[kill-dev-ports] 已结束占用 ${port} 的进程 PID ${pid}`)
    } catch {
      /* 进程可能已退出 */
    }
  }
}

function killOnUnix(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()

    if (!out) return

    for (const pid of out.split('\n')) {
      if (!pid) continue
      try {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
        console.log(`[kill-dev-ports] 已结束占用 ${port} 的进程 PID ${pid}`)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* 无占用 */
  }
}

if (process.platform === 'win32') {
  killOnWindows(PORT)
} else {
  killOnUnix(PORT)
}
