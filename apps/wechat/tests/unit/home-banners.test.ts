import { buildHomeBanners } from '../../src/pages/index/utils/home-banners'

jest.mock('../../src/utils/static-asset-cdn-url', () => ({
  CAFETERIA_HERO_BG_URL: 'https://cdn.test/wechat/cafeteria-hero.jpg',
}))

const base = { petName: null, rewardCredits: null, rewardTaskText: '' }

describe('home carousel', () => {
  it('leads with 高校伙伴计划 and drops the goose and canteen slides', () => {
    const banners = buildHomeBanners(base)
    expect(banners[0]).toMatchObject({ key: 'campus-partner', title: '高校伙伴计划', url: '/packageResearch/pages/campus-campaign/index' })
    const urls = banners.map(banner => banner.url)
    expect(urls.some(url => url.includes('goose-duck-chicken'))).toBe(false)
    expect(urls.some(url => url.includes('campus-canteen'))).toBe(false)
    expect(banners.map(banner => banner.key)).toEqual(['campus-partner', 'partner', 'invite', 'food-map', 'research-weight', 'lifespan', 'feedback'])
  })

  it('opens the 伙伴 tab with switchTab and uses the pet\'s own name', () => {
    const partner = buildHomeBanners({ ...base, petName: '豆豆' }).find(banner => banner.key === 'partner')!
    expect(partner).toMatchObject({ url: '/pages/pet/index', tab: true, title: '下一顿吃什么？' })
    expect(partner.desc).toContain('问问豆豆')
    expect(buildHomeBanners(base).find(banner => banner.key === 'partner')!.desc).toContain('问问健文伙伴')
    expect(JSON.stringify(buildHomeBanners(base))).not.toContain('小麦')
  })

  it('only offers today\'s credits when there are some to earn', () => {
    expect(buildHomeBanners({ ...base, rewardCredits: 0 }).some(banner => banner.key === 'reward')).toBe(false)
    const withCredits = buildHomeBanners({ ...base, rewardCredits: 6, rewardTaskText: '签到 +2' })
    const reward = withCredits.find(banner => banner.key === 'reward')!
    expect(reward).toMatchObject({ title: '今天还可以赚 6 积分', desc: '签到 +2' })
    expect(withCredits[withCredits.length - 1].key).toBe('feedback')
  })

  it('routes subpackage pages through their own package roots', () => {
    const byKey = Object.fromEntries(buildHomeBanners(base).map(banner => [banner.key, banner]))
    expect(byKey['research-weight'].url).toBe('/packageResearch/pages/research-weight/index')
    expect(byKey.invite.url).toBe('/packageExtra/pages/invite-friends/index')
    expect(byKey['food-map'].url).toBe('/packageExtra/pages/food-library/index')
    expect(byKey.partner.tab).toBe(true)
    expect(Object.values(byKey).filter(banner => banner.tab).map(banner => banner.key)).toEqual(['partner'])
  })
})
