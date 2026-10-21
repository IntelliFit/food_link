import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import SharePage from '../../src/packageExtra/pages/campus-food-share/index'
import CanteenPage from '../../src/packageExtra/pages/campus-canteen/index'
import { createCanteenFood, getPublicFoodLibraryList, uploadCampusFoodImageFile, getPublicFoodLibraryItem, correctCampusFood } from '../../src/utils/api'
import { chooseImageWithPrivacy } from '../../src/utils/weapp-privacy'
import { campusNutritionState } from '../../src/utils/campus-nutrition'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Button: ({ children, ...props }: any) => React.createElement('button', props, children),
    Input: ({ onInput, ...props }: any) => React.createElement('input', { ...props, onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }) }),
    Textarea: ({ onInput, ...props }: any) => React.createElement('textarea', { ...props, onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }) }),
    Image: ({ src }: any) => React.createElement('img', { src }),
    ScrollView: ({ children }: any) => children,
    PageMeta: () => null,
  }
})
jest.mock('@taroify/icons', () => ({ ArrowDown: () => null, ArrowRight: () => null, Ellipsis: () => null, FilterOutlined: () => null, Plus: () => null, Search: () => null }))
jest.mock('@taroify/icons/style', () => ({}))
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/components/FlPageThemeRoot', () => ({ FlPageThemeRoot: ({ children }: any) => children }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/components/SchoolPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CampusPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CanteenPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/FloorPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/WindowPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/utils/weapp-privacy', () => ({ chooseImageWithPrivacy: jest.fn(), isPrivacyAuthorizeError: jest.fn(() => false), showPrivacyAuthorizeFailure: jest.fn() }))
jest.mock('../../src/utils/api', () => ({
  createCanteenFood: jest.fn(), correctCampusFood: jest.fn(), getPublicFoodLibraryItem: jest.fn(),
  showUnifiedApiError: jest.fn(), uploadCampusFoodImageFile: jest.fn(),
  getAccessToken: jest.fn(() => 'test-token'), getPublicFoodLibraryList: jest.fn(), getCanteenLocations: jest.fn(() => Promise.resolve([])),
  getSchoolCampuses: jest.fn(() => Promise.resolve([])), getSchoolCanteens: jest.fn(() => Promise.resolve([])),
  getUserProfile: jest.fn(() => Promise.resolve({})), submitStructuredFeedback: jest.fn(),
}))

const location = { scope: 'campus', school_id: 's1', school_name: '示例大学', campus_id: 'a1', campus_name: '主校区', canteen_id: 'c1', canteen_name: '第一食堂' }
beforeEach(() => {
  jest.clearAllMocks()
  ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
  ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: location })
  ;(getPublicFoodLibraryList as jest.Mock).mockResolvedValue({ list: [] })
  ;(chooseImageWithPrivacy as jest.Mock).mockResolvedValue({ tempFilePaths: ['photo.jpg'] })
  ;(uploadCampusFoodImageFile as jest.Mock).mockResolvedValue({ imageUrl: 'campus-food/photo.jpg' })
  ;(createCanteenFood as jest.Mock).mockResolvedValue({ items: [{ id: 'new-food' }] })
})

it('exposes upload in the default all-canteen view and never opens the generic form', async () => {
  render(<CanteenPage />)
  fireEvent.click(screen.getByText('上传菜品'))
  expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/campus-food-share/index?scope=all' })
  expect(screen.getByText('采集领奖励')).toBeInTheDocument()
  expect(screen.queryByText('地点纠错')).not.toBeInTheDocument()
})

it('inherits the selected location and hides optional and unrelated meal fields', () => {
  render(<SharePage />)
  expect(screen.getByText('示例大学')).toBeInTheDocument()
  expect(screen.getByText('第一食堂')).toBeInTheDocument()
  expect(screen.queryByText('校园食堂')).not.toBeInTheDocument()
  expect(screen.queryByText('餐食来源')).not.toBeInTheDocument()
  expect(screen.queryByText('商家地址')).not.toBeInTheDocument()
  expect(screen.queryByPlaceholderText('如：12号窗口')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('补充信息（选填）'))
  expect(screen.getByPlaceholderText('如：12号窗口')).toBeInTheDocument()
})

it('allows editing while a photo uploads, saves the final name once, and opens that detail', async () => {
  let finish: (value: any) => void = () => {}
  ;(uploadCampusFoodImageFile as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
  render(<SharePage />)
  fireEvent.click(screen.getByText('添加照片'))
  await waitFor(() => expect(uploadCampusFoodImageFile).toHaveBeenCalledTimes(1))
  fireEvent.change(screen.getByPlaceholderText('如：麻辣牛肉粉＋卤蛋'), { target: { value: '麻辣牛肉粉＋卤蛋' } })
  expect(screen.getByDisplayValue('麻辣牛肉粉＋卤蛋')).toBeInTheDocument()
  expect(screen.getByText('发布菜品')).toBeDisabled()
  await act(async () => finish({ imageUrl: 'campus-food/photo.jpg' }))
  fireEvent.click(screen.getByText('发布菜品'))
  await waitFor(() => expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/food-library-detail/index?id=new-food&scene=campus' }))
  expect(createCanteenFood).toHaveBeenCalledWith(expect.objectContaining({ school_id: 's1', campus_id: 'a1', canteen_id: 'c1',
    entries: [expect.objectContaining({ name: '麻辣牛肉粉＋卤蛋', image_paths: ['campus-food/photo.jpg'], price_type: 'unknown' })] }))
  expect(Taro.showLoading).not.toHaveBeenCalled()
})

it('uploads community dishes without inventing school directory IDs', async () => {
  ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: { scope: 'community', organization_name: '青年社区', canteen_name: '邻里食堂' } })
  render(<SharePage />)
  expect(screen.queryByText('学校')).not.toBeInTheDocument()
  fireEvent.change(screen.getByPlaceholderText('如：麻辣牛肉粉＋卤蛋'), { target: { value: '番茄炒蛋' } })
  fireEvent.click(screen.getByText('添加照片'))
  await waitFor(() => expect(screen.getByText('发布菜品')).not.toBeDisabled())
  fireEvent.click(screen.getByText('发布菜品'))
  await waitFor(() => expect(createCanteenFood).toHaveBeenCalled())
  expect((createCanteenFood as jest.Mock).mock.calls[0][0]).toMatchObject({ venue_type: 'community', organization_name: '青年社区', school_id: undefined })
})

it('keeps failed submissions retryable with the same idempotency key', async () => {
  ;(createCanteenFood as jest.Mock).mockRejectedValueOnce(new Error('timeout'))
  render(<SharePage />)
  fireEvent.change(screen.getByPlaceholderText('如：麻辣牛肉粉＋卤蛋'), { target: { value: '青菜' } })
  fireEvent.click(screen.getByText('添加照片'))
  await waitFor(() => expect(screen.getByText('发布菜品')).not.toBeDisabled())
  fireEvent.click(screen.getByText('发布菜品'))
  await waitFor(() => expect(createCanteenFood).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByText('发布菜品')).not.toBeDisabled())
  fireEvent.click(screen.getByText('发布菜品'))
  await waitFor(() => expect(createCanteenFood).toHaveBeenCalledTimes(2))
  expect((createCanteenFood as jest.Mock).mock.calls[0][0].client_batch_key).toBe((createCanteenFood as jest.Mock).mock.calls[1][0].client_batch_key)
})

it('permits correcting a legacy text-only dish without forcing a new photo', async () => {
  ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: { correct_id: 'old-food' } })
  ;(getPublicFoodLibraryItem as jest.Mock).mockResolvedValue({ ...location, type: 'campus', food_name: '青菜', content_version: 2, image_paths: [], price_type: 'unknown' })
  render(<SharePage />)
  await waitFor(() => expect(screen.getByDisplayValue('青菜')).toBeInTheDocument())
  fireEvent.change(screen.getByPlaceholderText('如：12号窗口'), { target: { value: '12号' } })
  fireEvent.click(screen.getByText('保存修改'))
  await waitFor(() => expect(correctCampusFood).toHaveBeenCalledWith('old-food', expect.objectContaining({ base_version: 2, patch: expect.objectContaining({ window_name: '12号' }) })))
})

it('treats a linked stale analysis as running but never records old nutrition', () => {
  const state = campusNutritionState({ analysis_status: 'stale', analysis_task_id: 'new-task', total_calories: 665 } as any)
  expect(state.analyzing).toBe(true)
  expect(state.displayNutrition).toBe(false)
  expect(state.canRecord).toBe(false)
})
