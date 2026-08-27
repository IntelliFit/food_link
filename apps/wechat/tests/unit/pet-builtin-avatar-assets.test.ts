import * as fs from 'node:fs'
import * as path from 'node:path'

describe('pet builtin avatar assets', () => {
  const componentSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/components/PetAvatar.tsx'),
    'utf8',
  )
  const buildConfigSource = fs.readFileSync(
    path.resolve(__dirname, '../../config/index.ts'),
    'utf8',
  )
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> }
  const assetVerifierSource = fs.readFileSync(
    path.resolve(__dirname, '../../../../scripts/check-weapp-pet-assets.mjs'),
    'utf8',
  )

  it.each([
    ['jianwen-01', 'jianwen-01-idle.png'],
    ['huatuo-01', 'huatuo-01.png'],
    ['taiji-xiaozi-01', 'taiji-xiaozi-01.png'],
    ['xiaomai-01', 'xiaomai-01.png'],
    ['doudou-01', 'doudou-01.png'],
  ])('registers %s with a locally compatible PNG image', (avatarID, filename) => {
    expect(componentSource).toContain(`'${avatarID}'`)
    expect(componentSource).toContain(`/assets/pets/${filename}`)
    expect(fs.existsSync(path.resolve(__dirname, `../../src/assets/pets/${filename}`))).toBe(true)
  })

  it('does not use local WebP files for builtin avatars', () => {
    expect(componentSource).not.toMatch(/\/assets\/pets\/[^'"`]+\.webp/)
    expect(buildConfigSource).not.toMatch(/src\/assets\/pets\/[^'"`]+\.webp/)
  })

  it('copies the compatible PNG files into the mini-program package', () => {
    expect(buildConfigSource).toContain('src/assets/pets/jianwen-01-${frame}.png')
    expect(buildConfigSource).toContain('src/assets/pets/${avatar}.png')
  })

  it('blocks upload builds when a referenced pet PNG is missing from dist', () => {
    expect(packageJson.scripts?.['weapp:sync-pet-assets']).toContain('check-weapp-pet-assets.mjs --sync')
    expect(packageJson.scripts?.['weapp:verify-pet-assets']).toContain('check-weapp-pet-assets.mjs')
    for (const scriptName of ['build:weapp', 'build:weapp:preview', 'build:weapp:release']) {
      expect(packageJson.scripts?.[scriptName]).toContain('weapp:sync-pet-assets')
      expect(packageJson.scripts?.[scriptName]).toContain('weapp:verify-pet-assets')
    }
    for (const filename of [
      'jianwen-01-idle.png',
      'jianwen-01-blink.png',
      'jianwen-01-squash.png',
      'jianwen-01-jump.png',
      'huatuo-01.png',
      'taiji-xiaozi-01.png',
      'xiaomai-01.png',
      'doudou-01.png',
    ]) {
      expect(assetVerifierSource).toContain(filename)
    }
  })
})
