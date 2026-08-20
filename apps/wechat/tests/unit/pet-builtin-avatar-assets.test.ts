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
    ['xiaomai-01', 'xiaomai-01.webp'],
    ['doudou-01', 'doudou-01.webp'],
  ])('registers %s with a bundled image', (avatarID, filename) => {
    expect(componentSource).toContain(`'${avatarID}'`)
    expect(componentSource).toContain(`/assets/pets/${filename}`)
    expect(fs.existsSync(path.resolve(__dirname, `../../src/assets/pets/${filename}`))).toBe(true)
    expect(buildConfigSource).toContain(`'xiaomai-01', 'doudou-01'`)
  })
})
