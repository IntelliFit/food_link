import { render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import * as Taro from '@tarojs/taro'
import ProfilePage from '../../src/pages/profile/index'
import RewardCenterPage from '../../src/packageExtra/pages/reward-center/index'
import {
  friendGetRequestsOverview,
  getAnalyzeTaskCount,
  getFavoriteCount,
  getFoodExpiryDashboard,
  getFriendCount,
  getMyMembership,
  getMyVouchers,
  getRewardCenter,
  getUserProfile,
  getUserRecordDays,
} from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/components/AppColorSchemeContext', () => ({
  useAppColorScheme: () => ({ scheme: 'light' }),
}))

jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(() => 'token'),
  getUserProfile: jest.fn(),
  getUserRecordDays: jest.fn(),
  getMyMembership: jest.fn(),
  getFoodExpiryDashboard: jest.fn(),
  friendGetRequestsOverview: jest.fn(),
  getAnalyzeTaskCount: jest.fn(),
  getFriendCount: jest.fn(),
  getFavoriteCount: jest.fn(),
  clearAllStorage: jest.fn(),
  getRewardCenter: jest.fn(),
  getMyVouchers: jest.fn(),
  claimLoginCheckIn: jest.fn(),
  useVoucher: jest.fn(),
}))

describe('membership credit overview', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => {
      React.useEffect(callback, [])
    })
    ;(getUserProfile as jest.Mock).mockResolvedValue({
      id: 'user-1',
      nickname: '测试用户',
      onboarding_completed: true,
    })
    ;(getUserRecordDays as jest.Mock).mockResolvedValue({ record_days: 3 })
    ;(getMyMembership as jest.Mock).mockResolvedValue({
      is_pro: true,
      status: 'active',
      current_plan_code: 'standard_monthly',
      daily_credits_max: 40,
      daily_credits_used: 2,
      system_credits_remaining: 38,
      earned_credits_balance: 3,
    })
    ;(getFoodExpiryDashboard as jest.Mock).mockResolvedValue({
      active_count: 0,
      expired_count: 0,
      today_count: 0,
      soon_count: 0,
    })
    ;(friendGetRequestsOverview as jest.Mock).mockResolvedValue({ received: [] })
    ;(getAnalyzeTaskCount as jest.Mock).mockResolvedValue({ count: 0 })
    ;(getFriendCount as jest.Mock).mockResolvedValue({ count: 0 })
    ;(getFavoriteCount as jest.Mock).mockResolvedValue({ count: 0 })
    ;(getRewardCenter as jest.Mock).mockResolvedValue({
      earned_credits_balance: 3,
      today_earned_credits: 1,
      tasks: [],
      today_task_overview: { completed_count: 0, total_count: 0 },
    })
    ;(getMyVouchers as jest.Mock).mockResolvedValue({ items: [] })
  })

  it('shows today and persistent credits side by side without progress or reward levels', async () => {
    const { container } = render(<ProfilePage />)

    await waitFor(() => expect(screen.getByText('38')).toBeInTheDocument())
    expect(screen.getByText('今日可用')).toBeInTheDocument()
    expect(screen.getByText('每日清零 · 优先扣除')).toBeInTheDocument()
    expect(screen.getByText('奖励积分')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('长期保留')).toBeInTheDocument()
    const creditItems = container.querySelectorAll('.credit-overview__item')
    expect(creditItems[0]).toHaveTextContent('38份')
    expect(creditItems[1]).toHaveTextContent('3积分')
    expect(screen.queryByText('AI 使用时优先扣今日额度')).not.toBeInTheDocument()
    expect(container.querySelector('.progress-bar')).not.toBeInTheDocument()
    expect(container.querySelector('.segmented-progress')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Lv\d|探味新芽/)
  })

  it('does not assign a level to reward credits in the reward center', async () => {
    const { container } = render(<RewardCenterPage />)

    await waitFor(() => expect(screen.getByText('当前余额')).toBeInTheDocument())
    expect(container.textContent).not.toMatch(/Lv\d|探味新芽/)
    expect(container.querySelector('.reward-hero__segments')).not.toBeInTheDocument()
  })
})
