import { fireEvent, render, screen, within } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { CommunityRanking } from '../../src/pages/community/components/CommunityRanking'
import { getAccessToken } from '../../src/utils/api'
import { redirectToLogin } from '../../src/utils/withAuth'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  const wrap = (tag: string) => ({ children, className, onClick, 'aria-label': label }: any) => React.createElement(tag, { className, onClick, 'aria-label': label }, children)
  return { View: wrap('div'), Text: wrap('span'), Image: ({ src, className }: any) => React.createElement('img', { src, className, alt: '' }) }
})
jest.mock('../../src/utils/api', () => ({ getAccessToken: jest.fn() }))
jest.mock('../../src/utils/withAuth', () => ({ redirectToLogin: jest.fn() }))
jest.mock('../../src/components/iconfont', () => ({ IconTrendingUp: () => null }))

const previews = {
  loggedIn: true,
  loading: false,
  contribution: { rank: 1, user_id: 'one', nickname: '青禾', avatar: '', contribution_count: 128, standard_count: 128, packaged_count: 0, meal_count: 0, custom_count: 0, is_me: false },
  record: { rank: 1, user_id: 'two', nickname: '利维亚桑', avatar: '', checkin_count: 24, is_me: false },
  food: { rank: 1, food_id: 'food', name: '鸡胸肉', image_url: '', value: 31.02 },
}

describe('community ranking previews', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getAccessToken).mockReturnValue('test-token')
  })

  it('shows three real previews with their own period and units', () => {
    render(<CommunityRanking {...previews} />)
    const contribution = within(screen.getByLabelText('查看食物贡献榜'))
    expect(contribution.getByText('本月')).toBeInTheDocument()
    expect(contribution.getByText('青禾')).toBeInTheDocument()
    expect(contribution.getByText('128条')).toBeInTheDocument()
    const record = within(screen.getByLabelText('查看饮食记录榜'))
    expect(record.getByText('本周')).toBeInTheDocument()
    expect(record.getByText('24次')).toBeInTheDocument()
    const food = within(screen.getByLabelText('查看食物营养榜'))
    expect(food.getByText('蛋白质 / 100g')).toBeInTheDocument()
    expect(food.getByText('31g')).toBeInTheDocument()
  })

  it('opens the corresponding full leaderboard from each column and the shared link', () => {
    render(<CommunityRanking {...previews} />)
    for (const [label, query] of [
      ['查看食物贡献榜', 'section=user&ranking=contribution'],
      ['查看饮食记录榜', 'section=user'],
      ['查看食物营养榜', 'section=food&nutrient=protein'],
      ['查看完整排行榜', 'section=user'],
    ]) {
      fireEvent.click(screen.getByLabelText(label))
      expect(Taro.navigateTo).toHaveBeenLastCalledWith({ url: `/packageExtra/pages/checkin-leaderboard/index?${query}` })
    }
    expect(Taro.navigateTo).toHaveBeenCalledTimes(4)
  })

  it('does not expose user previews after logout and keeps the login guard', () => {
    jest.mocked(getAccessToken).mockReturnValue(null)
    render(<CommunityRanking {...previews} loggedIn={false} />)
    expect(screen.queryByText('青禾')).not.toBeInTheDocument()
    expect(screen.queryByText('利维亚桑')).not.toBeInTheDocument()
    expect(screen.getByText('鸡胸肉')).toBeInTheDocument()
    expect(screen.getAllByText('登录查看')).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('查看食物贡献榜'))
    expect(redirectToLogin).toHaveBeenCalledTimes(1)
    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })

  it('keeps successful neighboring previews when one ranking is unavailable', () => {
    render(<CommunityRanking {...previews} contribution={undefined} errors={{ contribution: true }} />)
    expect(screen.getByText('暂未获取')).toBeInTheDocument()
    expect(screen.queryByText('暂无贡献')).not.toBeInTheDocument()
    expect(screen.getByText('24次')).toBeInTheDocument()
    expect(screen.getByText('31g')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('查看食物贡献榜'))
    expect(Taro.navigateTo).toHaveBeenCalledTimes(1)
  })

  it('uses skeletons without loading text and keeps populated previews visible during refresh', () => {
    const view = render(<CommunityRanking loggedIn loading />)
    expect(screen.getAllByLabelText(/正在获取/)).toHaveLength(3)
    expect(screen.queryByText('加载中')).not.toBeInTheDocument()
    view.rerender(<CommunityRanking {...previews} loading />)
    expect(screen.queryByLabelText(/正在获取/)).not.toBeInTheDocument()
    expect(screen.getByText('128条')).toBeInTheDocument()
  })

  it('shows empty states without invented ranking values', () => {
    render(<CommunityRanking loggedIn loading={false} />)
    expect(screen.getByText('暂无贡献')).toBeInTheDocument()
    expect(screen.getByText('暂无记录')).toBeInTheDocument()
    expect(screen.getByText('暂无食物')).toBeInTheDocument()
    expect(screen.queryByText('128条')).not.toBeInTheDocument()
  })
})
