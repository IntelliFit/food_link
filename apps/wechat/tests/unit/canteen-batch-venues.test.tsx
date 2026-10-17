import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import CollectorPage from '../../src/packageExtra/pages/campus-food-collector/index'
import { applyCampusCollector, createCampusCollectorBatch, getCampusCollectorProfile, uploadCampusFoodImageFile } from '../../src/utils/api'
import { chooseImageWithPrivacy } from '../../src/utils/weapp-privacy'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Input: ({ onInput, ...props }: any) => React.createElement('input', { ...props, onChange: (event: any) => onInput?.({ detail: { value: event.target.value } }) }),
    Textarea: ({ onInput, ...props }: any) => React.createElement('textarea', { ...props, onChange: (event: any) => onInput?.({ detail: { value: event.target.value } }) }),
    Image: ({ src }: any) => React.createElement('img', { src }),
    ScrollView: ({ children }: any) => children,
  }
})
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/components/SchoolPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CampusPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CanteenPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/FloorPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/utils/weapp-privacy', () => ({ chooseImageWithPrivacy: jest.fn(), isPrivacyAuthorizeError: jest.fn(() => false), showPrivacyAuthorizeFailure: jest.fn() }))
jest.mock('../../src/utils/api', () => ({ applyCampusCollector: jest.fn(), createCampusCollectorBatch: jest.fn(), getCampusCollectorProfile: jest.fn(), uploadCampusFoodImageFile: jest.fn(), getCanteenFloors: jest.fn(), showUnifiedApiError: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: { venue_type: 'community', organization_name: 'AI原点社区', canteen_name: '原点食堂' } })
  ;(Taro.useDidShow as jest.Mock).mockImplementationOnce(callback => callback()).mockImplementation(() => {})
  ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true })
  ;(getCampusCollectorProfile as jest.Mock).mockResolvedValue({ applications: [], active_scopes: [], can_batch: false })
  ;(applyCampusCollector as jest.Mock).mockResolvedValue({ application: { id: 'application' } })
  ;(createCampusCollectorBatch as jest.Mock).mockResolvedValue({ items: [] })
  ;(chooseImageWithPrivacy as jest.Mock).mockResolvedValue({ tempFilePaths: ['photo.jpg'] })
  ;(uploadCampusFoodImageFile as jest.Mock).mockResolvedValue({ imageUrl: 'campus-food/photo.jpg' })
})

it('applies for a community venue without requesting school or campus fields', async () => {
  render(<CollectorPage />)
  await screen.findByText('申请批量采集通道')
  expect(screen.getByDisplayValue('AI原点社区')).toBeInTheDocument()
  expect(screen.queryByText('学校 *')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('提交申请'))
  await waitFor(() => expect(applyCampusCollector).toHaveBeenCalledWith(expect.objectContaining({ venue_type: 'community', organization_name: 'AI原点社区', canteen_name: '原点食堂' })))
  expect((applyCampusCollector as jest.Mock).mock.calls[0][0].school_id).toBeUndefined()
})

it.each(['community', 'office_park', 'corporate'] as const)('publishes an approved %s batch using the common venue information', async venueType => {
  ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: { venue_type: venueType } })
  ;(getCampusCollectorProfile as jest.Mock).mockResolvedValue({ applications: [], can_batch: true, active_scopes: [{ id: 'scope', venue_type: venueType, organization_name: 'AI原点社区', scope_canteen_name: '原点食堂', status: 'active' }] })
  render(<CollectorPage />)
  await screen.findByText('已授权批量通道')
  expect(screen.queryByText('学校 *')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('连续拍照 / 多选'))
  const dishName = await screen.findByPlaceholderText('第 1 道菜名称 *')
  fireEvent.change(dishName, { target: { value: '番茄鸡蛋饭' } })
  fireEvent.click(screen.getByText('批量立即发布'))
  await waitFor(() => expect(createCampusCollectorBatch).toHaveBeenCalledWith(expect.objectContaining({ venue_type: venueType, organization_name: 'AI原点社区', canteen_name: '原点食堂', entries: [expect.objectContaining({ name: '番茄鸡蛋饭' })] })))
  expect((createCampusCollectorBatch as jest.Mock).mock.calls[0][0].school_id).toBeUndefined()
})
