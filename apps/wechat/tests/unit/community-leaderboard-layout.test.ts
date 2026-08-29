import { readFileSync } from 'fs'
import { join } from 'path'

describe('community leaderboard redesign', () => {
  const communitySource = readFileSync(
    join(process.cwd(), 'src/pages/community/index.tsx'),
    'utf8',
  )
  const leaderboardSource = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/checkin-leaderboard/index.tsx'),
    'utf8',
  )

  it('splits the circle card into compact user and food ranking columns', () => {
    expect(communitySource).toContain("className='ranking-columns'")
    expect(communitySource).toContain('用户榜')
    expect(communitySource).toContain('食物榜')
    expect(communitySource).toContain('ranking=health')
    expect(communitySource).toContain('nutrient=fiber')
    expect(communitySource).toContain('nutrient=calcium')
  })

  it('makes the user scope explicit for each weekly ranking', () => {
    expect(communitySource).toContain('全体记录')
    expect(communitySource).toContain('好友健康')
    expect(leaderboardSource).toContain("isHealth ? '好友' : '全体用户'")
    expect(leaderboardSource).toContain('饮食记录榜')
  })

  it('explains the calibrated weekly healthy-eating score', () => {
    expect(leaderboardSource).toContain('健康饮食榜')
    expect(leaderboardSource).toContain('计分说明')
    expect(leaderboardSource).toContain('饮食质量')
    expect(leaderboardSource).toContain('记录连续性')
    expect(leaderboardSource).toContain('日间稳定性')
    expect(leaderboardSource).toContain('至少记录')
  })

  it('provides nutrient rankings on a per-100g basis', () => {
    expect(leaderboardSource).toContain('NUTRIENT_OPTIONS')
    expect(leaderboardSource).toContain('膳食纤维')
    expect(leaderboardSource).toContain('维生素B12')
    expect(leaderboardSource).toContain('标准食物库')
    expect(leaderboardSource).toContain('每100g')
  })
})
