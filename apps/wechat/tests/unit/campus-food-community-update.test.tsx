import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import CampusFoodDetailPage from '../../src/packageExtra/pages/food-library-detail/index'
import {
  getCampusFoodDetail,
  getCampusFoodRevisions,
  getPublicFoodLibraryComments,
} from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/utils/api', () => ({
  getCampusFoodDetail: jest.fn(),
  getCampusFoodRevisions: jest.fn(),
  getPublicFoodLibraryItem: jest.fn(),
  getPublicFoodLibraryComments: jest.fn(),
  likePublicFoodLibraryItem: jest.fn(),
  unlikePublicFoodLibraryItem: jest.fn(),
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

describe('campus food community update flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.useRouter as jest.Mock).mockReturnValue({
      path: '/packageExtra/pages/food-library-detail/index',
      params: { id: 'campus-food-v3', scene: 'campus' },
    })
    ;(getPublicFoodLibraryComments as jest.Mock).mockResolvedValue({ list: [] })
    ;(getCampusFoodDetail as jest.Mock).mockResolvedValue({
      item: {
        id: 'campus-food-v3', user_id: 'owner-1', type: 'campus', is_campus_food: true,
        food_name: '番茄炒蛋', image_path: 'https://cdn.example.com/a.jpg', image_paths: ['https://cdn.example.com/a.jpg'],
        total_calories: 320, total_protein: 16, total_carbs: 20, total_fat: 18, items: [],
        status: 'published', analysis_status: 'stale', nutrition_status: 'stale', content_version: 3,
        nutrition_source_version: 2, availability_status: 'available', last_verified_at: '2026-09-03T08:00:00Z',
        school_name: '示例大学', campus_name: '主校区', canteen_name: '第一食堂', price: 12, price_type: 'fixed', price_unit: '元/份',
        suitable_for_fat_loss: false, user_tags: [], like_count: 0, comment_count: 0, collection_count: 0,
        created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-03T08:00:00Z',
      }, metrics: {}, similar_items: [], related_feeds: [],
    })
    ;(getCampusFoodRevisions as jest.Mock).mockResolvedValue({
      items: [{
        id: 'revision-3', catalog_item_id: 'campus-food-v3', base_version: 2, result_version: 3,
        actor_type: 'user', action_type: 'update', before_snapshot: {}, proposed_patch: { price: 12 }, after_snapshot: {},
        changed_fields: ['price'], evidence_image_paths: [], reason: '窗口价格更新', created_at: '2026-09-03T08:00:00Z',
      }],
      page: 1, limit: 20, total: 1,
    })
  })

  it('opens a structured correction form for every campus viewer', async () => {
    render(<CampusFoodDetailPage />)
    await waitFor(() => expect(screen.getByText('当前版本 v3')).toBeInTheDocument())

    fireEvent.click(screen.getByText('修正资料'))

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/packageExtra/pages/campus-food-share/index?correct_id=campus-food-v3',
    })
  })

  it('loads immutable update history on demand', async () => {
    render(<CampusFoodDetailPage />)
    await waitFor(() => expect(screen.getByText('更新记录')).toBeInTheDocument())

    fireEvent.click(screen.getByText('更新记录'))

    await waitFor(() => expect(getCampusFoodRevisions).toHaveBeenCalledWith('campus-food-v3', 1, 20))
    expect(screen.getByText('v3')).toBeInTheDocument()
    expect(screen.getByText('更新价格')).toBeInTheDocument()
    expect(screen.getByText('窗口价格更新')).toBeInTheDocument()
  })
})
