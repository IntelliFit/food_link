import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import CapturePage from '../../src/packageExtra/pages/canteen-capture/index'
import {
  createCaptureSession,
  getCaptureSession,
  listCapturedWindows,
  startCaptureExtraction,
  submitCaptureSession,
  uploadCaptureAsset,
} from '../../src/utils/canteen-capture-api'
import type { CaptureSessionView } from '../../src/utils/canteen-capture-api'
import { chooseImageWithPrivacy } from '../../src/utils/weapp-privacy'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Input: ({ onInput, ...props }: any) => React.createElement('input', { ...props, onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }) }),
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
jest.mock('../../src/utils/api', () => ({ showUnifiedApiError: jest.fn(), getCanteenFloors: jest.fn(() => Promise.resolve([])) }))
jest.mock('../../src/utils/canteen-capture-api', () => ({
  createCaptureSession: jest.fn(), getCaptureSession: jest.fn(), listCapturedWindows: jest.fn(() => Promise.resolve([])),
  startCaptureExtraction: jest.fn(), submitCaptureSession: jest.fn(), updateCaptureAsset: jest.fn(), uploadCaptureAsset: jest.fn(),
  newCaptureKey: jest.fn(() => 'capture-key-1'),
}))

const reward = { status: 'eligible', amount_cents: 300, rates_published: true, photo_tier: 'none', sellable_items: 2, photo_items: 0, message: '再补拍 1 道菜的实物图可获得实物图加成' }

function sessionView(status: string, patch: Partial<CaptureSessionView> = {}): CaptureSessionView {
  return {
    session: {
      id: 'session-1', venue_type: 'community', organization_name: '测试园区', canteen_name: '一食堂', floor: '1楼', window_name: '上海风味',
      service_mode: 'unknown', status, exception_status: 'none', menu_item_count: 0, published_item_count: 0, exception_item_count: 0, photo_item_count: 0,
    } as any,
    assets: [], items: [], reward: reward as any, ...patch,
  }
}

const menuAsset = { id: 'asset-menu', session_id: 'session-1', kind: 'menu', url: 'https://cdn/menu.jpg' }
const extractedItems = [
  { key: 'k-shengjian', kind: 'dish', name: '生煎包', prices: [2.5], status: 'passed', source: 'model', dish_photo_urls: [] },
  { key: 'k-wonton', kind: 'dish', name: '老上海大馄饨', prices: [9], status: 'passed', source: 'model', dish_photo_urls: [] },
]

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  ;(Taro.getStorageSync as jest.Mock).mockReturnValue('')
  ;(chooseImageWithPrivacy as jest.Mock).mockResolvedValue({ tempFilePaths: ['wxfile://photo.jpg'] })
})

afterEach(() => {
  jest.useRealTimers()
})

it('walks one window from location to a submitted reward', async () => {
  ;(createCaptureSession as jest.Mock).mockResolvedValue(sessionView('draft'))
  ;(getCaptureSession as jest.Mock)
    .mockResolvedValueOnce(sessionView('draft', { assets: [menuAsset] as any }))
    .mockResolvedValueOnce(sessionView('extracted', { assets: [menuAsset] as any, items: extractedItems as any }))
    .mockResolvedValueOnce(sessionView('extracted', {
      assets: [menuAsset] as any,
      items: [{ ...extractedItems[0], dish_photo_urls: ['https://cdn/dish.jpg'] }, extractedItems[1]] as any,
    }))
  ;(startCaptureExtraction as jest.Mock).mockResolvedValue(sessionView('extracting', { assets: [menuAsset] as any }))
  ;(uploadCaptureAsset as jest.Mock).mockResolvedValue({ id: 'asset' })
  ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true })
  ;(submitCaptureSession as jest.Mock).mockResolvedValue(sessionView('submitted', {
    session: { ...sessionView('submitted').session, published_item_count: 2 },
    items: extractedItems.map(item => ({ ...item, status: 'published' })) as any,
    reward: { ...reward, status: 'confirmed' } as any,
  }))

  render(<CapturePage />)
  fireEvent.click(screen.getByText('社区食堂'))
  const inputs = screen.getAllByRole('textbox')
  fireEvent.change(inputs[0], { target: { value: '测试园区' } })
  fireEvent.change(inputs[1], { target: { value: '一食堂' } })
  fireEvent.change(screen.getByPlaceholderText('招牌名，如“上海风味”'), { target: { value: '上海风味' } })
  fireEvent.click(screen.getByText('自选·麻辣烫·称重'))
  await act(async () => { fireEvent.click(screen.getByText('开始采集这个窗口')) })

  expect(createCaptureSession).toHaveBeenCalledWith(expect.objectContaining({
    client_session_key: 'capture-key-1', venue_type: 'community', organization_name: '测试园区', canteen_name: '一食堂',
    window_name: '上海风味', service_mode: 'self_select',
  }))
  expect(Taro.setStorageSync).toHaveBeenCalledWith('canteen_capture_active_session', 'session-1')

  await act(async () => { fireEvent.click(screen.getByText('拍菜单')) })
  expect(chooseImageWithPrivacy).toHaveBeenCalledWith(expect.objectContaining({ sizeType: ['original'] }))
  expect(uploadCaptureAsset).toHaveBeenCalledWith('session-1', 'wxfile://photo.jpg', 'menu')

  await act(async () => { fireEvent.click(screen.getByText('识别菜单')) })
  await act(async () => { jest.advanceTimersByTime(3000) })
  await waitFor(() => expect(screen.getByText('生煎包')).toBeInTheDocument())
  expect(screen.getByText('2.5 元')).toBeInTheDocument()

  await act(async () => { fireEvent.click(screen.getAllByText('拍实物')[0]) })
  expect(uploadCaptureAsset).toHaveBeenLastCalledWith('session-1', 'wxfile://photo.jpg', 'dish', { itemKey: 'k-shengjian' })
  await waitFor(() => expect(screen.getByText('再拍')).toBeInTheDocument())

  await act(async () => { fireEvent.click(screen.getByText('提交这个窗口')) })
  expect(submitCaptureSession).toHaveBeenCalledWith('session-1')
  expect(Taro.removeStorageSync).toHaveBeenCalledWith('canteen_capture_active_session')
  expect(screen.getByText('已获得 ¥3.00')).toBeInTheDocument()
  expect(screen.getByText('采下一个窗口')).toBeInTheDocument()
})

it('blocks submit until the menu photos are recognised', async () => {
  ;(Taro.getStorageSync as jest.Mock).mockReturnValue('session-1')
  ;(getCaptureSession as jest.Mock).mockResolvedValue(sessionView('draft', { assets: [menuAsset] as any }))
  render(<CapturePage />)
  await waitFor(() => expect(screen.getByText('请先识别菜单')).toBeInTheDocument())
  fireEvent.click(screen.getByText('请先识别菜单'))
  expect(submitCaptureSession).not.toHaveBeenCalled()
  expect(listCapturedWindows).not.toHaveBeenCalled()
})
