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
})
