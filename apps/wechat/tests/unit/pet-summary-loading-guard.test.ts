import * as fs from 'node:fs'
import * as path from 'node:path'

describe('pet summary loading guard', () => {
  it.each([
    '../../src/pages/index/index.tsx',
    '../../src/packageExtra/pages/pet-home/index.tsx',
    '../../src/packageExtra/pages/pet-chat/index.tsx',
  ])('uses cached retry loading in %s', (relativePath) => {
    const source = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
    expect(source).toContain('loadPetSummaryWithRetry')
    expect(source).toContain('getStoredPetSummary')
  })

  it('clears the user-scoped pet cache from the profile cache action', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/pages/profile/index.tsx'),
      'utf8',
    )
    expect(source).toContain('Taro.removeStorageSync(PET_SUMMARY_CACHE_KEY)')
  })
})
