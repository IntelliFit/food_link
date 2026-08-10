import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import CampusCanteenPage from '../../src/packageExtra/pages/campus-canteen/index'
import {
  getMyMembership,
  getPublicFoodLibraryList,
  getSchoolCampuses,
  getSchoolCanteens,
} from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/components/AppColorSchemeContext', () => ({
  useAppColorScheme: () => ({ scheme: 'light' }),
}))

jest.mock('../../src/components/FlPageThemeRoot', () => ({
  FlPageThemeRoot: ({ children }: any) => children,
}))

jest.mock('../../src/components/CampusMembershipGate', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../../src/components/CampusPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CanteenPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/FloorPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/WindowPicker', () => ({ __esModule: true, default: () => null }))

jest.mock('../../src/components/SchoolPicker', () => ({
  __esModule: true,
  default: ({ visible, onSelect }: any) =>
    visible ? (
      <button
        onClick={() =>
          onSelect({
            id: 'school-shanghai-tcm',
            name: '上海中医药大学',
            location_type: 'university',
          })
        }
      >
        选择上海中医药大学
      </button>
    ) : null,
}))

jest.mock('../../src/utils/theme-navigation-bar', () => ({
  applyThemeNavigationBar: jest.fn(),
}))

jest.mock('../../src/utils/static-asset-cdn-url', () => ({
  CAFETERIA_HERO_BG_URL: 'https://cdn.example.com/campus.jpg',
}))

jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(() => 'test-token'),
  getMyMembership: jest.fn(),
  getPublicFoodLibraryList: jest.fn(),
  getSchoolCampuses: jest.fn(),
  getSchoolCanteens: jest.fn(),
  showUnifiedApiError: jest.fn(),
  submitStructuredFeedback: jest.fn(),
}))

describe('campus canteen directory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.useDidShow as jest.Mock)
      .mockImplementationOnce((callback) => callback())
      .mockImplementation(() => {})
    ;(getMyMembership as jest.Mock).mockResolvedValue({ is_pro: true })
    ;(getPublicFoodLibraryList as jest.Mock).mockResolvedValue({ list: [] })
    ;(getSchoolCampuses as jest.Mock).mockResolvedValue([
      {
        id: 'campus-zhangjiang',
        school_id: 'school-shanghai-tcm',
        name: '张江校区',
        status: 'active',
      },
    ])
    ;(getSchoolCanteens as jest.Mock).mockResolvedValue([
      {
        id: 'canteen-student',
        school_id: 'school-shanghai-tcm',
        campus_id: 'campus-zhangjiang',
        campus_name: '张江校区',
        name: '学生食堂',
        location_text: '蔡伦路1200号',
        status: 'active',
      },
    ])
  })

  it('shows imported canteens even when no analyzed dishes are published yet', async () => {
    render(<CampusCanteenPage />)

    await waitFor(() => expect(getMyMembership).toHaveBeenCalled())
    fireEvent.click(screen.getByText('选择学校'))
    fireEvent.click(screen.getByText('选择上海中医药大学'))

    await waitFor(() =>
      expect(getSchoolCanteens).toHaveBeenCalledWith('school-shanghai-tcm'),
    )

    expect(screen.getByText('已收录食堂')).toBeInTheDocument()
    expect(screen.getByText('学生食堂')).toBeInTheDocument()
    expect(screen.getByText('张江校区 · 蔡伦路1200号')).toBeInTheDocument()
    expect(screen.getByText('该食堂目录已上线，暂无已分析菜品')).toBeInTheDocument()
    expect(screen.queryByText('暂无校园食堂数据')).not.toBeInTheDocument()
  })

  it('uses the selected canteen id without conflicting parent filters', async () => {
    render(<CampusCanteenPage />)

    await waitFor(() => expect(getMyMembership).toHaveBeenCalled())
    fireEvent.click(screen.getByText('选择学校'))
    fireEvent.click(screen.getByText('选择上海中医药大学'))
    await waitFor(() => expect(screen.getByText('学生食堂')).toBeInTheDocument())
    fireEvent.click(screen.getByText('学生食堂'))

    await waitFor(() => {
      const calls = (getPublicFoodLibraryList as jest.Mock).mock.calls
      const latestRequest = calls[calls.length - 2]?.[0]
      expect(latestRequest).toEqual(
        expect.objectContaining({ canteen_id: 'canteen-student', type: 'campus' }),
      )
      expect(latestRequest).not.toHaveProperty('school_id')
      expect(latestRequest).not.toHaveProperty('campus_id')
      expect(latestRequest).not.toHaveProperty('school_name')
      expect(latestRequest).not.toHaveProperty('canteen_name')
    })
  })

  it('never renders pending or failed AI dishes in the client list', async () => {
    ;(getPublicFoodLibraryList as jest.Mock).mockResolvedValue({
      list: [
        { id: 'ready', food_name: '已分析鸡肉饭', status: 'published', analysis_status: '', total_calories: 520, total_protein: 32, total_carbs: 60, total_fat: 14, items: [] },
        { id: 'failed', food_name: '失败菜品', status: 'published', analysis_status: 'failed', total_calories: 0, total_protein: 0, total_carbs: 0, total_fat: 0, items: [] },
        { id: 'pending', food_name: '分析中菜品', status: 'pending', analysis_status: 'processing', total_calories: 0, total_protein: 0, total_carbs: 0, total_fat: 0, items: [] },
      ],
    })

    render(<CampusCanteenPage />)

    await waitFor(() => expect(screen.getAllByText('已分析鸡肉饭').length).toBeGreaterThan(0))
    expect(screen.queryByText('失败菜品')).not.toBeInTheDocument()
    expect(screen.queryByText('分析中菜品')).not.toBeInTheDocument()
    expect(screen.queryByText('分析失败，稍后重试')).not.toBeInTheDocument()
  })

  it('falls back to ready campus dishes when the initial hot page is empty', async () => {
    const readyDish = {
      id: 'ready-fallback',
      food_name: '高蛋白鸡肉饭',
      status: 'published',
      analysis_status: '',
      total_calories: 520,
      total_protein: 32,
      total_carbs: 60,
      total_fat: 14,
      like_count: 8,
      collection_count: 3,
      items: [],
    }
    ;(getPublicFoodLibraryList as jest.Mock).mockImplementation(({ sort_by }) =>
      Promise.resolve({ list: sort_by === 'hot' ? [] : [readyDish] }),
    )

    render(<CampusCanteenPage />)

    await waitFor(() =>
      expect(screen.getAllByText('高蛋白鸡肉饭').length).toBeGreaterThan(0),
    )
    expect(screen.getByText('热门')).toHaveClass('active')
    expect(getPublicFoodLibraryList).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sort_by: 'hot', type: 'campus' }),
    )
    expect(getPublicFoodLibraryList).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sort_by: 'high_protein', type: 'campus' }),
    )
  })
})
