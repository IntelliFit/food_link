#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'

const distDir = path.resolve(process.cwd(), process.argv[2] || 'dist')

function walkWxssFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(fullPath)
      else if (entry.isFile() && entry.name.endsWith('.wxss')) files.push(fullPath)
    }
  }
  return files
}

function hasStandardDisplay(rule) {
  return rule.nodes?.some(
    (node) => node.type === 'decl' && node.prop === 'display' && /^(?:inline-)?flex$/.test(node.value)
  )
}

function canRemoveWebkitDeclaration(decl) {
  if (!decl.prop.startsWith('-webkit-')) return false
  // 这些 WebKit 扩展在小程序中仍承担截断或字体渲染语义，不能机械删除。
  if (['-webkit-line-clamp', '-webkit-box-orient', '-webkit-font-smoothing'].includes(decl.prop)) {
    return false
  }
  const standardProp = decl.prop.slice('-webkit-'.length)
  return decl.parent?.nodes?.some(
    (node) => node.type === 'decl' && node !== decl && node.prop === standardProp
  )
}

let filesChanged = 0
let bytesSaved = 0

for (const file of walkWxssFiles(distDir)) {
  const input = fs.readFileSync(file, 'utf8')
  const root = postcss.parse(input, { from: file })

  root.walkDecls((decl) => {
    // IE 专属声明对微信基础库无效，标准声明由同一规则保留。
    if (decl.prop.startsWith('-ms-')) {
      decl.remove()
      return
    }
    if (decl.prop === 'display' && /^-(?:webkit|ms)-(?:inline-)?flex(?:box)?$/.test(decl.value)) {
      if (hasStandardDisplay(decl.parent)) decl.remove()
      return
    }
    if (canRemoveWebkitDeclaration(decl)) decl.remove()
  })

  const output = root.toString()
  if (output !== input) {
    fs.writeFileSync(file, output)
    filesChanged += 1
    bytesSaved += Buffer.byteLength(input) - Buffer.byteLength(output)
  }
}

console.log(
  `[weapp:wxss] optimized ${filesChanged} files, saved ${(bytesSaved / 1024).toFixed(1)}KB`
)
