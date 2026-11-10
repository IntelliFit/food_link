import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import FoodCameraPage from '../../src/packageCamera/pages/shoot'
import { getAccessToken, getMyMembership } from '../../src/utils/api'
import { chooseImageWithPrivacy } from '../../src/utils/weapp-privacy'

jest.mock('../../src/components/CreditShortageSheet', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/iconfont', () => ({ IconAlbum: () => null }))
jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(() => 'test-token'),
  getMyMembership: jest.fn(() => Promise.resolve({})),
}))
jest.mock('../../src/utils/membership', () => jest.requireActual('../../src/utils/membership'))
jest.mock('../../src/utils/weapp-privacy', () => ({
  ensureWeappPrivacyAuthorized: jest.fn(() => Promise.resolve()),
  chooseImageWithPrivacy: jest.fn(),
  isCameraAuthorizationError: jest.fn(() => false),
  isPrivacyAuthorizeError: jest.fn(() => false),
  showCameraAuthorizationFailure: jest.fn(),
  showPrivacyAuthorizeFailure: jest.fn(),
}))
jest.mock('../../src/packageCamera/pages/shoot/crop', () => ({
  cropPhotoToFrame: jest.fn((_selector: string, path: string) => Promise.resolve(path)),
}))

const storage = new Map<string, unknown>()
const shows = new Set<() => void>()
const hides = new Set<() => void>()
let params: Record<string, string>

const settle = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const shoot = async () => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText('拍照'))
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 10, 10, 23, 59, 55))
  jest.clearAllMocks()
  params = { date: '2026-11-08' }
  storage.clear()
  shows.clear()
  hides.clear()
  storage.set('home_selected_date_v1', '2026-11-08')
  storage.set('recordTargetDate', '2026-11-08')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => storage.delete(key))
  ;(Taro.useRouter as jest.Mock).mockImplementation(() => ({ params }))
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => shows.add(callback))
  ;(Taro.useDidHide as jest.Mock).mockImplementation(callback => hides.add(callback))
  ;(Taro.navigateTo as jest.Mock).mockResolvedValue({})
  ;(Taro.navigateBack as jest.Mock).mockResolvedValue({})
  ;(Taro.redirectTo as jest.Mock).mockResolvedValue({})
  ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
  ;(getMyMembership as jest.Mock).mockResolvedValue({})
  ;(Taro as any).createCameraContext = jest.fn(() => ({
    takePhoto: jest.fn(({ success }) => success({ tempImagePath: 'wxfile://fresh-today.jpg' })),
  }))
})

afterEach(() => {
  jest.useRealTimers()
})

it('ignores old home/global dates for a new photo and routes to today', async () => {
  render(<FoodCameraPage />)
  await settle()
  expect(screen.getByText('记到今天')).toBeInTheDocument()
  expect(storage.get('recordTargetDate')).toBe('2026-11-10')
  await shoot()
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?date=2026-11-10' })
  expect(storage.get('analyzeImagePaths')).toEqual(['wxfile://fresh-today.jpg'])
})

it('updates the default day while the camera remains in the foreground across midnight', async () => {
  render(<FoodCameraPage />)
  await settle()
  act(() => jest.advanceTimersByTime(10_000))
  expect(storage.get('recordTargetDate')).toBe('2026-11-11')
  expect(screen.getByText('记到今天')).toBeInTheDocument()
  await shoot()
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?date=2026-11-11' })
})

it('updates on returning from background instead of pinning the initial day', async () => {
  render(<FoodCameraPage />)
  await settle()
  act(() => { hides.forEach(callback => callback()); jest.setSystemTime(new Date(2026, 10, 12, 10)) })
  act(() => { shows.forEach(callback => callback()) })
  expect(storage.get('recordTargetDate')).toBe('2026-11-12')
  await shoot()
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?date=2026-11-12' })
})

it('resolves at the photo action even before a foreground refresh has rendered', async () => {
  render(<FoodCameraPage />)
  await settle()
  jest.setSystemTime(new Date(2026, 10, 11, 10))
  await shoot()
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?date=2026-11-11' })
})

it('preserves an explicitly chosen valid backfill date through a later photo', async () => {
  params = { date: '2026-11-08', backfill: '1' }
  render(<FoodCameraPage />)
  await settle()
  expect(screen.getByText('记到 11月8日')).toBeInTheDocument()
  act(() => jest.advanceTimersByTime(10_000))
  await shoot()
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?date=2026-11-08&backfill=1' })
})

it('resolves the current default day when switching to another record mode', async () => {
  render(<FoodCameraPage />)
  await settle()
  jest.setSystemTime(new Date(2026, 10, 11, 10))
  fireEvent.click(screen.getByText('文字'))
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/record-text/index?date=2026-11-11' })
})

it('returns all selected photos without overwriting the opener’s explicit record day', async () => {
  params = { return: '1', max: '3' }
  ;(chooseImageWithPrivacy as jest.Mock).mockResolvedValue({ tempFilePaths: ['wxfile://a.jpg', 'wxfile://b.jpg'] })
  render(<FoodCameraPage />)
  await settle()
  act(() => jest.advanceTimersByTime(10_000))
  await act(async () => {
    fireEvent.click(screen.getByText('相册'))
    await Promise.resolve()
  })
  expect(Taro.navigateBack).toHaveBeenCalledTimes(1)
  expect(storage.get('recordTargetDate')).toBe('2026-11-08')
  expect(storage.get('foodCameraReturnPaths')).toEqual(['wxfile://a.jpg', 'wxfile://b.jpg'])
  expect(Taro.redirectTo).not.toHaveBeenCalled()
})

it('allows a historical capture when today is exhausted but the target day has credits', async () => {
  params = { date: '2026-11-08', backfill: '1' }
  storage.set('access_token', 'test-token')
  storage.set('user_id', 'user-a')
  ;(getMyMembership as jest.Mock).mockImplementation(async (date?: string) => ({
    is_pro: false, daily_credits_max: 20, system_credits_remaining: date ? 20 : 0,
    earned_credits_balance: 0, total_credits_available: date ? 20 : 0,
  }))
  render(<FoodCameraPage />)
  await settle()
  await shoot()
  expect(getMyMembership).toHaveBeenCalledWith('2026-11-08')
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?date=2026-11-08&backfill=1' })
})

it('keeps a same-day capture blocked when its credits are exhausted', async () => {
  storage.set('access_token', 'test-token')
  storage.set('user_id', 'user-a')
  ;(getMyMembership as jest.Mock).mockResolvedValue({
    is_pro: false, daily_credits_max: 20, system_credits_remaining: 0,
    earned_credits_balance: 0, total_credits_available: 0,
  })
  render(<FoodCameraPage />)
  await settle()
  await shoot()
  expect(Taro.createCameraContext).not.toHaveBeenCalled()
  expect(Taro.redirectTo).not.toHaveBeenCalled()
})
