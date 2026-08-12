import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scriptPath = fileURLToPath(new URL('./check-weapp-package-size.mjs', import.meta.url))
const MAIN_BUDGET_BYTES = 1464 * 1024

function makeDist(totalBytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foodlink-weapp-size-'))
  const appJson = '{}'
  fs.writeFileSync(path.join(root, 'app.json'), appJson)
  fs.writeFileSync(path.join(root, 'main.bin'), Buffer.alloc(totalBytes - Buffer.byteLength(appJson)))
  return root
}

function runSizeCheck(dist) {
  return spawnSync(process.execPath, [scriptPath, '--dist', dist, '--top', '0'], {
    encoding: 'utf8',
  })
}

test('accepts a main package at the 1464KB safe budget', (t) => {
  const dist = makeDist(MAIN_BUDGET_BYTES)
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }))

  const result = runSizeCheck(dist)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /WARN main\s+1464\.0KB/)
})

test('rejects a main package even one byte above the 1464KB safe budget', (t) => {
  const dist = makeDist(MAIN_BUDGET_BYTES + 1)
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }))

  const result = runSizeCheck(dist)

  assert.equal(result.status, 1)
  assert.match(result.stdout, /BUDGET main\s+1464\.0KB/)
  assert.match(result.stderr, /main 1464\.0KB > enforced budget 1464KB/)
})

test('rejects a main-package require that points into a subpackage', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foodlink-weapp-boundary-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'packageExtra'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'app.json'),
    JSON.stringify({ subpackages: [{ root: 'packageExtra', pages: ['pages/example/index'] }] })
  )
  fs.writeFileSync(path.join(root, 'common.js'), 'require("./packageExtra/taroify-vendor.js")')
  fs.writeFileSync(path.join(root, 'packageExtra', 'taroify-vendor.js'), 'module.exports = {}')

  const result = runSizeCheck(root)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /JS 不得同步 require 其他分包模块/)
  assert.match(result.stderr, /common\.js -> packageExtra\/taroify-vendor\.js/)
})

test('rejects a require from one subpackage into another subpackage', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foodlink-weapp-cross-subpackage-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'packageA'), { recursive: true })
  fs.mkdirSync(path.join(root, 'packageB'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'app.json'),
    JSON.stringify({
      subpackages: [
        { root: 'packageA', pages: ['pages/a/index'] },
        { root: 'packageB', pages: ['pages/b/index'] },
      ],
    })
  )
  fs.writeFileSync(path.join(root, 'packageA', 'a.js'), 'require("../packageB/shared.js")')
  fs.writeFileSync(path.join(root, 'packageB', 'shared.js'), 'module.exports = {}')

  const result = runSizeCheck(root)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /packageA\/a\.js -> packageB\/shared\.js/)
})
