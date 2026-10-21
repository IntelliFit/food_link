import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import CanteenPage from '../../src/packageExtra/pages/campus-canteen/index'
import { getCanteenLocations, getPublicFoodLibraryList } from '../../src/utils/api'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Button: ({ children, ariaLabel, ...props }: any) => React.createElement('button', { ...props, 'aria-label': ariaLabel }, children),
    Input: ({ onInput, ...props }: any) => React.createElement('input', { ...props, onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }) }),
    Image: ({ src }: any) => React.createElement('img', { src }),
    ScrollView: ({ children }: any) => children,
  }
})
jest.mock('@taroify/icons', () => ({ ArrowDown: () => null, ArrowRight: () => null, Ellipsis: () => null, FilterOutlined: () => null, Plus: () => null, Search: () => null }))
jest.mock('@taroify/icons/style', () => ({}))
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/components/FlPageThemeRoot', () => ({ FlPageThemeRoot: ({ children }: any) => children }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/components/SchoolPicker', () => ({
  __esModule: true,
  default: ({ visible, onSelect }: any) => visible ? <button onClick={() => onSelect({ id: 'school-1', name: '示例大学' })}>选择示例大学</button> : null,
}))
jest.mock('../../src/components/CampusPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CanteenPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/FloorPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/WindowPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(() => 'test-token'), getPublicFoodLibraryList: jest.fn(), getCanteenLocations: jest.fn(),
  getSchoolCampuses: jest.fn(() => Promise.resolve([])), getSchoolCanteens: jest.fn(() => Promise.resolve([])),
  getUserProfile: jest.fn(() => Promise.resolve({})), showUnifiedApiError: jest.fn(), submitStructuredFeedback: jest.fn(),
}))

beforeEach(() => {
  jest.clearAllMocks()
  ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
  ;(getPublicFoodLibraryList as jest.Mock).mockResolvedValue({ list: [] })
  ;(getCanteenLocations as jest.Mock).mockResolvedValue([
    { organization_key: 'yuandian', organization_name: 'AI原点社区', city: '北京', district: '', canteen_key: 'one', canteen_name: '原点食堂', address: 'B座B1', food_count: 3 },
    { organization_key: 'yuandian', organization_name: 'AI原点社区', city: '北京', district: '', canteen_key: 'two', canteen_name: '原点二食堂', address: 'B座B1', food_count: 1 },
  ])
})

it('keeps one upload entry and one batch entry before and after selecting a school', async () => {
  render(<CanteenPage />)
  expect(screen.getAllByRole('button', { name: '上传菜品' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: '采集领奖励' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '校园' }))
  fireEvent.click(screen.getByText('选择学校'))
  fireEvent.click(screen.getByText('选择示例大学'))
  await waitFor(() => expect(screen.queryByText('选择学校')).not.toBeInTheDocument())
  expect(screen.getAllByRole('button', { name: '上传菜品' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: '采集领奖励' })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '食堂更多操作' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '菜品更多操作' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '采集领奖励' }))
  expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/canteen-capture/index?venue_type=university&school_id=school-1&school_name=%E7%A4%BA%E4%BE%8B%E5%A4%A7%E5%AD%A6' })
})

it('shows the canonical community once and uses its shared key to fetch all canteens', async () => {
  render(<CanteenPage />)
  fireEvent.click(screen.getByRole('button', { name: '社区·园区' }))
  expect(screen.getByRole('button', { name: '采集领奖励' })).toBeInTheDocument()
  await waitFor(() => expect(getCanteenLocations).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '选择社区或园区' }))
  const community = await screen.findByRole('button', { name: 'AI原点社区 北京' })
  expect(screen.getAllByRole('button', { name: 'AI原点社区 北京' })).toHaveLength(1)
  fireEvent.click(community)
  await waitFor(() => expect(getPublicFoodLibraryList).toHaveBeenCalledWith(expect.objectContaining({ canteen_scope: 'community', venue_organization_key: 'yuandian' })))
  fireEvent.click(screen.getByRole('button', { name: '选择社区内食堂' }))
  expect(await screen.findByText('原点食堂')).toBeInTheDocument()
  expect(screen.getByText('原点二食堂')).toBeInTheDocument()
})
