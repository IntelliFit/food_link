#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_MAX_KB = 2048
const DEFAULT_BUDGET_KB = 1900
const DEFAULT_WARN_KB = 1800
const DEFAULT_TOP_COUNT = 12
const DEFAULT_TOTAL_MAX_KB = 20 * 1024

function parseArgs(argv) {
  const options = {
    dist: 'dist',
    maxKb: DEFAULT_MAX_KB,
    budgetKb: DEFAULT_BUDGET_KB,
    warnKb: DEFAULT_WARN_KB,
    totalMaxKb: DEFAULT_TOTAL_MAX_KB,
    top: DEFAULT_TOP_COUNT,
    warnOnly: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--dist' && next) {
      options.dist = next
      i += 1
    } else if (arg === '--max-kb' && next) {
      options.maxKb = Number(next)
      i += 1
    } else if (arg === '--budget-kb' && next) {
      options.budgetKb = Number(next)
      i += 1
    } else if (arg === '--warn-kb' && next) {
      options.warnKb = Number(next)
      i += 1
    } else if (arg === '--total-max-kb' && next) {
      options.totalMaxKb = Number(next)
      i += 1
    } else if (arg === '--top' && next) {
      options.top = Number(next)
      i += 1
    } else if (arg === '--warn-only') {
      options.warnOnly = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage: node scripts/check-weapp-package-size.mjs [options]

Options:
  --dist <path>          Mini program output directory, default: dist
  --max-kb <number>      Per package hard limit, default: ${DEFAULT_MAX_KB}
  --budget-kb <number>   Per package enforced budget, default: ${DEFAULT_BUDGET_KB}
  --warn-kb <number>     Per package warning threshold, default: ${DEFAULT_WARN_KB}
  --total-max-kb <num>   Total package hard limit, default: ${DEFAULT_TOTAL_MAX_KB}
  --top <number>         Number of largest files to print per package, default: ${DEFAULT_TOP_COUNT}
  --warn-only            Print failures but exit 0
`)
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, '/')
}

function bytesToKb(bytes) {
  return bytes / 1024
}

function formatKb(bytes) {
  return `${bytesToKb(bytes).toFixed(1)}KB`
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const result = []
  const stack = [dir]

  while (stack.length > 0) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        result.push(fullPath)
      }
    }
  }

  return result
}

function isSourceMap(filePath) {
  return filePath.endsWith('.map')
}

function packageSize(files) {
  return files.reduce((sum, file) => sum + fs.statSync(file).size, 0)
}

function relativeFile(distDir, file) {
  return normalizeSlashes(path.relative(distDir, file))
}

function getLargestFiles(files, distDir, count) {
  return files
    .map((file) => ({ file, bytes: fs.statSync(file).size }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, count)
    .map((item) => `${formatKb(item.bytes).padStart(9)}  ${relativeFile(distDir, item.file)}`)
}

function readAppConfig(distDir) {
  const appJsonPath = path.join(distDir, 'app.json')
  if (!fs.existsSync(appJsonPath)) {
    throw new Error(`找不到 ${appJsonPath}，请先运行小程序构建`)
  }
  return JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
}

function getSubpackageRoots(appConfig) {
  const subpackages = appConfig.subpackages || appConfig.subPackages || []
  return subpackages
    .map((subpackage) => String(subpackage.root || '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
}

function startsWithRoot(relFile, root) {
  return relFile === root || relFile.startsWith(`${root}/`)
}

function buildPackageReports(distDir, topCount) {
  const appConfig = readAppConfig(distDir)
  const subpackageRoots = getSubpackageRoots(appConfig)
  const allFiles = walkFiles(distDir).filter((file) => !isSourceMap(file))

  const subpackageReports = subpackageRoots.map((root) => {
    const files = allFiles.filter((file) => startsWithRoot(relativeFile(distDir, file), root))
    return {
      name: root,
      root,
      files,
      bytes: packageSize(files),
      largest: getLargestFiles(files, distDir, topCount),
    }
  })

  const mainFiles = allFiles.filter((file) => {
    const rel = relativeFile(distDir, file)
    return !subpackageRoots.some((root) => startsWithRoot(rel, root))
  })

  return {
    totalBytes: packageSize(allFiles),
    reports: [
      {
        name: 'main',
        root: '',
        files: mainFiles,
        bytes: packageSize(mainFiles),
        largest: getLargestFiles(mainFiles, distDir, topCount),
      },
      ...subpackageReports,
    ],
  }
}

function findInvalidCrossPackageRequires(distDir, reports) {
  const subpackageRoots = reports.filter((report) => report.name !== 'main').map((report) => report.root)
  if (subpackageRoots.length === 0) return []

  const packageForFile = (relFile) =>
    subpackageRoots.find((root) => startsWithRoot(relFile, root)) || 'main'

  const violations = []
  const requirePattern = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
  const jsFiles = reports.flatMap((report) => report.files).filter((candidate) => candidate.endsWith('.js'))
  for (const file of jsFiles) {
    const sourceRel = relativeFile(distDir, file)
    const sourcePackage = packageForFile(sourceRel)
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(requirePattern)) {
      const request = match[1]
      if (!request.startsWith('.')) continue
      const resolved = normalizeSlashes(path.relative(distDir, path.resolve(path.dirname(file), request)))
      const targetPackage = packageForFile(resolved)
      // 分包可以复用主包模块；主包不能依赖分包，两个独立分包也不能同步互引。
      if (targetPackage !== 'main' && targetPackage !== sourcePackage) {
        violations.push(`${sourceRel} -> ${resolved} (${sourcePackage} -> ${targetPackage})`)
      }
    }
  }
  return violations
}

function statusFor(bytes, maxKb, budgetKb, warnKb) {
  const kb = bytesToKb(bytes)
  if (kb > maxKb) return 'FAIL'
  if (kb > budgetKb) return 'BUDGET'
  if (kb > warnKb) return 'WARN'
  return 'OK'
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const distDir = path.resolve(process.cwd(), options.dist)
  const { reports, totalBytes } = buildPackageReports(distDir, options.top)
  const failures = []
  const crossPackageRequires = findInvalidCrossPackageRequires(distDir, reports)

  if (options.warnKb > options.budgetKb || options.budgetKb > options.maxKb) {
    throw new Error('体积阈值必须满足 warn-kb <= budget-kb <= max-kb')
  }

  console.log('[weapp:size] package size report')
  console.log(`[weapp:size] dist=${path.relative(process.cwd(), distDir) || '.'}`)
  console.log(`[weapp:size] per-package hard limit=${options.maxKb}KB, enforced budget=${options.budgetKb}KB, warning=${options.warnKb}KB, total limit=${options.totalMaxKb}KB`)

  for (const report of reports) {
    const status = statusFor(report.bytes, options.maxKb, options.budgetKb, options.warnKb)
    const line = `${status.padEnd(4)} ${report.name.padEnd(24)} ${formatKb(report.bytes).padStart(10)}  ${report.files.length} files`
    console.log(line)
    if (status === 'FAIL') {
      failures.push(`${report.name} ${formatKb(report.bytes)} > ${options.maxKb}KB`)
    }
    if (status === 'BUDGET') {
      failures.push(`${report.name} ${formatKb(report.bytes)} > enforced budget ${options.budgetKb}KB`)
    }
    if (status !== 'OK' && report.largest.length > 0) {
      console.log(`     largest files:`)
      for (const item of report.largest) {
        console.log(`     ${item}`)
      }
    }
  }

  const totalKb = bytesToKb(totalBytes)
  const totalStatus = totalKb > options.totalMaxKb ? 'FAIL' : 'OK'
  console.log(`${totalStatus.padEnd(4)} ${'total'.padEnd(24)} ${formatKb(totalBytes).padStart(10)}`)
  if (totalStatus === 'FAIL') {
    failures.push(`total ${formatKb(totalBytes)} > ${options.totalMaxKb}KB`)
  }

  if (crossPackageRequires.length > 0) {
    console.error('[weapp:size] JS 不得同步 require 其他分包模块：')
    for (const violation of crossPackageRequires) console.error(`[weapp:size]   ${violation}`)
    failures.push(`${crossPackageRequires.length} 个非法跨包同步依赖`)
  }

  if (failures.length > 0) {
    console.error(`[weapp:size] failed: ${failures.join('; ')}`)
    if (!options.warnOnly) process.exit(1)
  }
}

main()
