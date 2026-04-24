/**
 * 跨平台启动 backend：优先使用 backend/venv 内 Python，否则用 PATH 上的 python。
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const net = require('net')

const backendDir = path.join(__dirname, '..', 'backend')
const isWin = process.platform === 'win32'
const venvPython = path.join(
  backendDir,
  'venv',
  isWin ? 'Scripts' : 'bin',
  isWin ? 'python.exe' : 'python'
)

const python = fs.existsSync(venvPython) ? venvPython : isWin ? 'python' : 'python3'
const port = Number(process.env.PORT || 3010)

function ensurePortAvailable(targetPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        reject(
          new Error(
            `[run-backend] 端口 ${targetPort} 已被占用。请先关闭已有后端进程，或改用 PORT=其它端口 npm run dev:backend。`
          )
        )
        return
      }
      reject(error)
    })
    server.listen(targetPort, '0.0.0.0', () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError)
          return
        }
        resolve()
      })
    })
  })
}

async function main() {
  try {
    await ensurePortAvailable(port)
  } catch (error) {
    console.error(error?.message || error)
    process.exit(1)
  }

  const child = spawn(python, ['run_backend.py'], {
    stdio: 'inherit',
    cwd: backendDir,
    shell: false,
    env: {
      ...process.env,
      PORT: String(port),
    },
  })

  child.on('exit', (code) => process.exit(code ?? 0))
}

main()
