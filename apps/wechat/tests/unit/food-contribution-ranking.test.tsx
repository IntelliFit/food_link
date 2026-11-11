import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Taro, { useRouter } from '@tarojs/taro'
import { FoodContributionRankEntry } from '../../src/components/FoodContributionRankEntry'
import ContributionPage from '../../src/packageExtra/pages/food-contribution'
import LeaderboardPage from '../../src/packageExtra/pages/checkin-leaderboard'
import { communityGetFoodContributionLeaderboard, getAccessToken, type FoodContributionLeaderboardResult } from '../../src/utils/api'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  const wrap = (tag: string) => ({ children, className, onClick, style, 'aria-label': label }: any) => React.createElement(tag, { className, onClick, style, 'aria-label': label }, children)
  return { View: wrap('div'), Text: wrap('span'), ScrollView: wrap('div'), Image: ({ src, className }: any) => React.createElement('img', { src, className }) }
})
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (component: unknown) => component }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(), communityGetFoodContributionLeaderboard: jest.fn(),
  communityGetCheckinLeaderboard: jest.fn(), communityGetHealthLeaderboard: jest.fn(), communityGetFoodNutrientLeaderboard: jest.fn(),
  showUnifiedApiError: jest.fn(),
}))

const result: FoodContributionLeaderboardResult = {
  period: 'month', start_date: '2026-11-01', end_date: '2026-11-30',
  list: [{ rank: 1, user_id: 'me', nickname: '贡献者', avatar: '', contribution_count: 3, packaged_count: 2, standard_count: 1, meal_count: 0, custom_count: 0, is_me: true }],
}

describe('food contribution ranking entry and page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getAccessToken).mockReturnValue('test-token')
    jest.mocked(useRouter).mockReturnValue({ ...useRouter(), path: '/packageExtra/pages/checkin-leaderboard/index', params: { section: 'user', ranking: 'contribution' } })
    jest.mocked(communityGetFoodContributionLeaderboard).mockReset().mockResolvedValue(result)
  })

  it('opens the same ranking from the reusable feed entry and the contribution home', () => {
    const first = render(<FoodContributionRankEntry />)
    fireEvent.click(screen.getByLabelText('查看食物贡献榜'))
    expect(Taro.navigateTo).toHaveBeenLastCalledWith({ url: '/packageExtra/pages/checkin-leaderboard/index?section=user&ranking=contribution' })
    first.unmount()
    render(<ContributionPage />)
    expect(screen.getByText('共建食物数据库')).toBeInTheDocument()
    expect(screen.getByText('包装食品')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('查看食物贡献榜'))
    expect(Taro.navigateTo).toHaveBeenLastCalledWith({ url: '/packageExtra/pages/checkin-leaderboard/index?section=user&ranking=contribution' })
  })

  it('loads the monthly contribution count and switches to the all-time list', async () => {
    render(<LeaderboardPage />)
    expect(await screen.findByText('3项')).toBeInTheDocument()
    expect(communityGetFoodContributionLeaderboard).toHaveBeenCalledWith('month')
    expect(screen.getByText('第1名 · 3项')).toBeInTheDocument()
    expect(screen.getByText('仅统计有效公开新增，同一条目只计一次。')).toBeInTheDocument()
    jest.mocked(communityGetFoodContributionLeaderboard).mockResolvedValueOnce({ period: 'all', list: [{ ...result.list[0], contribution_count: 20 }] })
    fireEvent.click(screen.getByText('总榜'))
    expect(await screen.findByText('20项')).toBeInTheDocument()
    expect(communityGetFoodContributionLeaderboard).toHaveBeenLastCalledWith('all')
    expect(screen.getByText('累计有效贡献')).toBeInTheDocument()
  })

  it('ignores a late monthly response after the all-time tab was selected', async () => {
    let finishMonth!: (value: any) => void
    jest.mocked(communityGetFoodContributionLeaderboard).mockImplementationOnce(() => new Promise(resolve => { finishMonth = resolve }))
    jest.mocked(communityGetFoodContributionLeaderboard).mockResolvedValueOnce({ period: 'all', list: [{ ...result.list[0], contribution_count: 7 }] })
    render(<LeaderboardPage />)
    fireEvent.click(screen.getByText('总榜'))
    await screen.findByText('7项')
    await act(async () => finishMonth(result))
    expect(screen.getByText('7项')).toBeInTheDocument()
    expect(screen.queryByText('3项')).not.toBeInTheDocument()
  })

  it('offers contribution when there are no entries and retries actual read failures', async () => {
    jest.mocked(communityGetFoodContributionLeaderboard).mockRejectedValueOnce(new Error('read failed'))
    jest.mocked(communityGetFoodContributionLeaderboard).mockResolvedValueOnce({ period: 'month', list: [] })
    render(<LeaderboardPage />)
    await screen.findByText('重试')
    fireEvent.click(screen.getByText('重试'))
    await waitFor(() => expect(screen.getByText('还未上榜 · 0项有效贡献')).toBeInTheDocument())
    fireEvent.click(screen.getByText('去贡献 ›'))
    expect(Taro.navigateTo).toHaveBeenLastCalledWith({ url: '/packageExtra/pages/food-contribution/index' })
  })
})
