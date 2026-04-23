const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const rootDir = path.join(__dirname, '..')
const pidFile = path.join(rootDir, 'backend', 'backend.pid')
const targetPort = Number(process.env.PORT || 3010)

function tryKillPid(pid) {
  if (!pid || Number.isNaN(pid)) return false
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch (_) {
    return false
  }
}

function findPidByPort(port) {
  try {
    const output = execSync(`cmd /c netstat -ano | findstr LISTENING | findstr :${port}`, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim()
    if (!output) return null
    const firstLine = output.split(/\r?\n/)[0]
    const parts = firstLine.trim().split(/\s+/)
    return Number(parts[parts.length - 1])
  } catch (_) {
    return null
  }
}

let stopped = false

if (fs.existsSync(pidFile)) {
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim())
  if (tryKillPid(pid)) {
    console.log(`[stop-backend] 已停止 backend.pid 对应进程 PID=${pid}`)
    stopped = true
  }
}

const portPid = findPidByPort(targetPort)
if (portPid && tryKillPid(portPid)) {
  console.log(`[stop-backend] 已停止占用端口 ${targetPort} 的进程 PID=${portPid}`)
  stopped = true
}

if (!stopped) {
  console.log(`[stop-backend] 未发现占用端口 ${targetPort} 的后端进程`)
}
