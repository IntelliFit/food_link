import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, '../public/brand/miniprogram-qrcode.png')
const apiUrl = process.env.QRCODE_API_URL ?? 'https://healthymax.cn/api/qrcode'

async function main() {
  mkdirSync(dirname(outPath), { recursive: true })

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene: 'website',
      page: 'pages/index/index',
      width: 430,
      check_path: false,
      env_version: 'release',
    }),
  })

  if (!res.ok) {
    console.warn(`[fetch:qrcode] HTTP ${res.status}, skipping`)
    process.exit(0)
  }

  const json = await res.json()
  const base64 =
    json?.data?.base64 ?? json?.base64 ?? (typeof json?.data === 'string' ? json.data : null)

  if (!base64 || typeof base64 !== 'string') {
    console.warn('[fetch:qrcode] No base64 in response, skipping')
    process.exit(0)
  }

  const raw = base64.replace(/^data:image\/\w+;base64,/, '')
  writeFileSync(outPath, Buffer.from(raw, 'base64'))
  console.log(`[fetch:qrcode] Wrote ${outPath}`)
}

main().catch((err) => {
  console.warn('[fetch:qrcode] Failed:', err.message)
  process.exit(0)
})
