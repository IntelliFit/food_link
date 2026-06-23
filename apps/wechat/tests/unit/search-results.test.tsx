import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import SearchResultsPage from '../../src/packageExtra/pages/search-results/index'
import { communitySearch } from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/utils/api', () => ({
  communitySearch: jest.fn(),
  communityLike: jest.fn(),
  communityUnlike: jest.fn(),
  showUnifiedApiError: jest.fn(),
}))

describe('search-results page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
    ;(Taro.useRouter as jest.Mock).mockReturnValue({
      path: '/packageExtra/pages/search-results/index',
      params: {
        keyword: encodeURIComponent('米饭'),
        focus: '0',
      },
    })
  })

  it('renders manual food-library cards, keeps AI image results, and cards long exercise items only', async () => {
    ;(communitySearch as jest.Mock).mockResolvedValue({
      list: [
        {
          target_type: 'food_record',
          target_id: 'food-manual-1',
          user_id: 'user-1',
          description: '手动记录：午餐',
          entry_type: 'food_library',
          items: [
            {
              name: '白米饭',
              manual_source: 'nutrition_library',
              manual_source_id: 'food-1',
              manual_source_title: '白米饭',
              nutrients: { calories: 228 },
              image_path: 'https://cdn.example.com/rice.jpg',
            },
            {
              name: '煎鸡蛋',
              manual_source: 'nutrition_library',
              manual_source_id: 'food-2',
              manual_source_title: '煎鸡蛋',
              nutrients: { calories: 120 },
            },
          ],
          author: { id: 'user-1', nickname: '小明', avatar: '' },
          liked: false,
          like_count: 0,
          comment_count: 0,
        },
        {
          target_type: 'food_record',
          target_id: 'food-ai-1',
          user_id: 'user-2',
          description: 'AI 图片分析结果',
          entry_type: 'food_image',
          image_path: 'https://cdn.example.com/meal-ai.jpg',
          items: [
            {
              name: '不该显示成库卡',
              manual_source: 'nutrition_library',
              manual_source_id: 'food-hidden',
              manual_source_title: '不该显示成库卡',
              nutrients: { calories: 1 },
            },
          ],
          author: { id: 'user-2', nickname: '小红', avatar: '' },
          liked: false,
          like_count: 0,
          comment_count: 0,
        },
        {
          target_type: 'exercise_log',
          target_id: 'exercise-short-1',
          user_id: 'user-3',
          description: '晚间跑步 5 公里',
          author: { id: 'user-3', nickname: '小刚', avatar: '' },
          liked: false,
          like_count: 0,
          comment_count: 0,
        },
        {
          target_type: 'exercise_log',
          target_id: 'exercise-long-1',
          user_id: 'user-4',
          description: '完整背部训练计划长文本',
          exercise_items: [
            {
              name: '杠铃深蹲',
              duration_min: 18,
              sets: 4,
              reps: 8,
              intensity: 'high',
              met: 6,
              calories_kcal: 126,
            },
          ],
          author: { id: 'user-4', nickname: '小力', avatar: '' },
          liked: false,
          like_count: 0,
          comment_count: 0,
        },
      ],
      has_more: false,
      content_count: 4,
      user_count: 0,
    })

    const { container } = render(<SearchResultsPage />)

    await waitFor(() => expect(communitySearch).toHaveBeenCalled())

    expect(screen.getByText('白米饭')).toBeInTheDocument()
    expect(screen.getByText('煎鸡蛋')).toBeInTheDocument()
    expect(screen.getAllByText('常用食物')).toHaveLength(2)

    expect(screen.getByText('AI 图片分析结果')).toBeInTheDocument()
    expect(screen.queryByText('不该显示成库卡')).not.toBeInTheDocument()
    expect(container.querySelector('img[src="https://cdn.example.com/meal-ai.jpg"]')).not.toBeNull()

    expect(screen.getByText('晚间跑步 5 公里')).toBeInTheDocument()
    expect(screen.getAllByText('运动记录')).toHaveLength(2)
    expect(screen.getByText('杠铃深蹲')).toBeInTheDocument()
    expect(screen.getByText('高强度')).toBeInTheDocument()
    expect(screen.getByText('126 kcal')).toBeInTheDocument()
    expect(screen.queryByText('完整背部训练计划长文本')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('白米饭'))
    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: expect.stringContaining('/pages/interaction-feed-detail/index?'),
    })
    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: expect.stringContaining('targetId=food-manual-1'),
    })
  })
})
