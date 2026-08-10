import { render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import { readFileSync } from 'fs'
import { join } from 'path'
import CampusFoodDetailPage from '../../src/packageExtra/pages/food-library-detail/index'
import {
  getCampusFoodDetail,
  getPublicFoodLibraryComments,
} from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/components/AppColorSchemeContext', () => ({
  useAppColorScheme: () => ({ scheme: 'light' }),
}))

jest.mock('../../src/utils/theme-navigation-bar', () => ({
  applyThemeNavigationBar: jest.fn(),
}))

jest.mock('../../src/utils/api', () => ({
  getCampusFoodDetail: jest.fn(),
  getPublicFoodLibraryItem: jest.fn(),
  likePublicFoodLibraryItem: jest.fn(),
  unlikePublicFoodLibraryItem: jest.fn(),
  getPublicFoodLibraryComments: jest.fn(),
  postPublicFoodLibraryComment: jest.fn(),
  deletePublicFoodLibraryComment: jest.fn(),
  submitStructuredFeedback: jest.fn(),
  showUnifiedApiError: jest.fn(),
  collectPublicFoodLibraryItem: jest.fn(),
  uncollectPublicFoodLibraryItem: jest.fn(),
  deletePublicFoodLibraryItem: jest.fn(),
  contributeCampusFoodImages: jest.fn(),
  uploadAnalyzeImageFile: jest.fn(),
}))

describe('campus food detail minimal layout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.useRouter as jest.Mock).mockReturnValue({
      path: '/packageExtra/pages/food-library-detail/index',
      params: { id: 'campus-food-1', scene: 'campus' },
    })
    ;(getPublicFoodLibraryComments as jest.Mock).mockResolvedValue({ list: [] })
    ;(getCampusFoodDetail as jest.Mock).mockResolvedValue({
      item: {
        id: 'campus-food-1',
        type: 'campus',
        is_campus_food: true,
        food_name: '宫保鸡丁',
        description: '',
        image_path: '',
        image_paths: [],
        total_calories: 358,
        total_protein: 24.5,
        total_carbs: 28.2,
        total_fat: 15.4,
        like_count: 0,
        collection_count: 0,
        comment_count: 0,
        liked: false,
        collected: false,
        school_name: '北京大学',
        canteen_name: '勺园食堂',
        window_name: '西餐厅',
        campus_location_text: '北京大学 · 勺园食堂 · 西餐厅',
        merchant_name: '勺园食堂',
        merchant_address: '北京大学 · 勺园食堂 · 西餐厅',
        price: 18,
        price_unit: '元/份',
        price_type: 'fixed',
        portion_description: '约 1 份',
        items: [],
        author: { nickname: '食探官方', avatar: '' },
        published_at: '2026-08-10T08:00:00Z',
      },
      metrics: {
        protein_per_yuan: 1.4,
        price_per_100_kcal: 5.03,
      },
      similar_items: [
        { id: 'similar-1', food_name: '鱼香肉丝', image_path: '' },
      ],
      related_feeds: [
        { id: 'feed-1', food_name: '食堂午餐分享', like_count: 8 },
      ],
    })
  })

  it('keeps one concise campus summary and omits recommendation and merchant sections', async () => {
    const { container } = render(<CampusFoodDetailPage />)

    await waitFor(() => expect(screen.getByText('宫保鸡丁')).toBeInTheDocument())

    expect(screen.queryByText('同食堂相似菜品')).not.toBeInTheDocument()
    expect(screen.queryByText('圈子相关动态')).not.toBeInTheDocument()
    expect(screen.queryByText('商家信息')).not.toBeInTheDocument()
    expect(screen.getAllByText('北京大学 · 勺园食堂 · 西餐厅')).toHaveLength(1)
    expect(container.querySelector('.food-detail-page--campus')).toBeInTheDocument()
  })

  it('defines exactly three scoped text sizes for the campus detail layout', () => {
    const styles = readFileSync(
      join(process.cwd(), 'src/packageExtra/pages/food-library-detail/index.scss'),
      'utf8',
    )
    const typographyBlock = styles.match(
      /\/\* campus-detail-typography:start \*\/([\s\S]*?)\/\* campus-detail-typography:end \*\//,
    )?.[1] || ''

    expect(typographyBlock).toContain('$campus-detail-font-title: 36rpx;')
    expect(typographyBlock).toContain('$campus-detail-font-body: 28rpx;')
    expect(typographyBlock).toContain('$campus-detail-font-meta: 24rpx;')
    expect(typographyBlock).not.toContain('*:not(.iconfont)')
    expect(typographyBlock).toMatch(/\.info-description,[\s\S]*?font-size:\s*\$campus-detail-font-body/)
    expect(typographyBlock.match(/font-size:\s*\$campus-detail-font-(?:title|body|meta)/g)).not.toBeNull()
    expect(typographyBlock.match(/\$campus-detail-font-(?:title|body|meta):/g)).toHaveLength(3)
  })
})
