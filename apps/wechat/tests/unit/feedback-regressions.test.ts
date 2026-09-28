import { readFileSync } from 'fs'
import { join } from 'path'

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8')
}

describe('feedback regression contracts', () => {
  it('opens collected foods through the extra subpackage route', () => {
    const source = readSource('packageExtra/pages/profile-settings/index.tsx')
    expect(source).toContain("`${extraPkgUrl('/pages/food-library-detail/index')}?id=")
  })

  it('reuses the moments image grid on the profile feed', () => {
    const source = readSource('packageExtra/pages/profile-settings/index.tsx')
    expect(source).toContain('collectFoodDisplayImageUrls(record)')
    expect(source).toContain('<FeedImageGrid urls={displayImagePaths} />')
    expect(source).not.toContain('profile-feed-image-wrap')
    expect(source).not.toContain('profile-feed-image-grid-item')
  })

  it('merges the returned user profile into the existing local cache', () => {
    const source = readSource('packageExtra/pages/profile-settings/index.tsx')
    expect(source).toContain('const updated = await updateUserInfo')
    expect(source).toContain('...stored,')
    expect(source).toContain('...updated,')
    expect(source).toContain('nickname: resolvedNickname')
  })

  it('exposes a visible comment delete action in feed and detail views', () => {
    expect(readSource('pages/community/index.tsx')).toContain("className='comment-delete-action'")
    expect(readSource('packageExtra/pages/interaction-feed-detail/index.tsx')).toContain("className='comment-delete-action'")
  })
})
