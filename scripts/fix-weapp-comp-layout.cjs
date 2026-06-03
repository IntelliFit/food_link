/**
 * Taro 4 + Vite 会把 React 运行时 comp 产物写在 dist 根目录（comp.js / comp.json / comp.wxml），
 * 但各页面 usingComponents 引用的是相对路径目录 ../../comp → dist/comp/。
 * 微信开发者工具扫描分包时找不到 dist/comp，会报 path undefined。
 */
const fs = require('fs')
const path = require('path')

const DIST = path.join(__dirname, '..', 'dist')
const COMP_DIR = path.join(DIST, 'comp')

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}

function writeCompDir() {
  const compJs = readIfExists(path.join(DIST, 'comp.js'))
  const compWxml = readIfExists(path.join(DIST, 'comp.wxml'))
  const compWxss = readIfExists(path.join(DIST, 'comp.wxss'))
  const compMap = readIfExists(path.join(DIST, 'comp.js.map'))

  if (!compJs || !compWxml) {
    console.warn('[fix-weapp-comp-layout] skip: dist/comp.js or dist/comp.wxml missing (run taro build first)')
    return false
  }

  fs.mkdirSync(COMP_DIR, { recursive: true })

  const indexJs = compJs.replace(/require\("\.\/taro\.js"\)/, 'require("../taro.js")')
  const indexWxml = compWxml
    .replace(/src="\.\/base\.wxml"/, 'src="../base.wxml"')
    .replace(/src="\.\/utils\.wxs"/, 'src="../utils.wxs"')

  fs.writeFileSync(path.join(COMP_DIR, 'index.js'), indexJs, 'utf8')
  fs.writeFileSync(
    path.join(COMP_DIR, 'index.json'),
    JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2),
    'utf8'
  )
  fs.writeFileSync(path.join(COMP_DIR, 'index.wxml'), indexWxml, 'utf8')

  if (compWxss) {
    fs.writeFileSync(path.join(COMP_DIR, 'index.wxss'), compWxss, 'utf8')
  }
  if (compMap) {
    const indexMap = compMap.replace(/"\.\/taro\.js"/g, '"../taro.js"')
    fs.writeFileSync(path.join(COMP_DIR, 'index.js.map'), indexMap, 'utf8')
  }

  console.log('[fix-weapp-comp-layout] created dist/comp/ for WeChat DevTools')
  return true
}

writeCompDir()
