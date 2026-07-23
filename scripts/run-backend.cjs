/**
 * 跨平台启动 Go backend server。
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const net = require('net')
const dotenv = require('dotenv')

const backendDir = path.join(__dirname, '..', 'backend')
const port = Number(process.env.PORT || 3010)

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return
  }

  const parsed = dotenv.parse(fs.readFileSync(filePath))
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value
  }
}

function loadBackendEnv() {
  loadEnvFile(path.join(backendDir, '.env'))
  loadEnvFile(path.join(backendDir, '.env.local'))
}

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
    loadBackendEnv()
    await ensurePortAvailable(port)
  } catch (error) {
    console.error(error?.message || error)
    process.exit(1)
  }

  const child = spawn('go', ['run', './cmd/server'], {
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
