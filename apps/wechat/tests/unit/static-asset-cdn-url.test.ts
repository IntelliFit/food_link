/** @jest-environment node */

function setFoodImagesCdnBaseUrl(value: string): void {
  ;(global as typeof globalThis & { __FOOD_IMAGES_CDN_BASE_URL__?: string }).__FOOD_IMAGES_CDN_BASE_URL__ =
    value
}

function loadStaticAssetCdnUrl(): typeof import('../../src/utils/static-asset-cdn-url') {
  jest.resetModules()
  return require('../../src/utils/static-asset-cdn-url') as typeof import('../../src/utils/static-asset-cdn-url')
}

describe('static-asset-cdn-url', () => {
  beforeEach(() => {
    setFoodImagesCdnBaseUrl('')
  })

  it('builds login logo url over https food-images CDN', () => {
    const mod = loadStaticAssetCdnUrl()
    expect(mod.LOGIN_LOGO_URL).toBe(
      'https://cdn-food-images.coachlink.fit/wechat/source-login-logo.png'
    )
  })

  it('defaults cafeteria hero to https CDN url', () => {
    const mod = loadStaticAssetCdnUrl()
    expect(mod.CAFETERIA_HERO_BG_URL).toBe(
      'https://cdn-food-images.coachlink.fit/wechat/cafeteria-hero.jpg'
    )
  })

  it('upgrades injected http CDN base to https for weapp image loading', () => {
    setFoodImagesCdnBaseUrl('http://cdn-food-images.coachlink.fit')
    const mod = loadStaticAssetCdnUrl()
    expect(mod.getFoodImagesCdnBaseUrl()).toBe('https://cdn-food-images.coachlink.fit')
    expect(mod.CAFETERIA_HERO_BG_URL).toBe(
      'https://cdn-food-images.coachlink.fit/wechat/cafeteria-hero.jpg'
    )
  })
})
