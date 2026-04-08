/**
 * 跨平台启动 backend：优先使用 backend/venv 内 Python，否则用 PATH 上的 python。
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const backendDir = path.join(__dirname, '..', 'backend')
const isWin = process.platform === 'win32'
const venvPython = path.join(
  backendDir,
  'venv',
  isWin ? 'Scripts' : 'bin',
  isWin ? 'python.exe' : 'python'
)

const python = fs.existsSync(venvPython) ? venvPython : isWin ? 'python' : 'python3'
const child = spawn(python, ['run_backend.py'], {
  stdio: 'inherit',
  cwd: backendDir,
  shell: false,
})

child.on('exit', (code) => process.exit(code ?? 0))
