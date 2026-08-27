import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const expectedPetAssets = [
  'jianwen-01-idle.png',
  'jianwen-01-blink.png',
  'jianwen-01-squash.png',
  'jianwen-01-jump.png',
  'huatuo-01.png',
  'taiji-xiaozi-01.png',
  'xiaomai-01.png',
  'doudou-01.png',
]

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const petAssetDirectory = fileURLToPath(new URL('../apps/wechat/dist/assets/pets/', import.meta.url))
const petSourceDirectory = fileURLToPath(new URL('../apps/wechat/src/assets/pets/', import.meta.url))
const retiredWebPAssets = expectedPetAssets.map((filename) => filename.replace(/\.png$/, '.webp'))
const failures = []

if (process.argv.includes('--sync')) {
  mkdirSync(petAssetDirectory, { recursive: true })
  for (const filename of expectedPetAssets) {
    copyFileSync(`${petSourceDirectory}${filename}`, `${petAssetDirectory}${filename}`)
  }
  for (const filename of retiredWebPAssets) {
    rmSync(`${petAssetDirectory}${filename}`, { force: true })
  }
  console.log(`宠物资源已同步：${expectedPetAssets.length} 个 PNG`)
}

for (const filename of expectedPetAssets) {
  const assetPath = `${petAssetDirectory}${filename}`
  try {
    if (statSync(assetPath).size <= pngSignature.length) {
      failures.push(`${filename} 文件为空`)
      continue
    }
    const signature = readFileSync(assetPath).subarray(0, pngSignature.length)
    if (!signature.equals(pngSignature)) failures.push(`${filename} 不是有效 PNG`)
  } catch (_) {
    failures.push(`${filename} 缺失`)
  }
}

for (const filename of retiredWebPAssets) {
  if (existsSync(`${petAssetDirectory}${filename}`)) failures.push(`${filename} 是应清理的旧资源`)
}

if (failures.length > 0) {
  console.error(`宠物资源产物校验失败：\n- ${failures.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`宠物资源产物校验通过：${expectedPetAssets.length} 个 PNG`)
}
