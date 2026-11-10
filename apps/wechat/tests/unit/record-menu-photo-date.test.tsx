import { act, fireEvent, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { RecordMenu } from '../../src/pages/index/components/RecordMenu'
import { getAccessToken, getMyMembership } from '../../src/utils/api'
import { redirectToLogin } from '../../src/utils/withAuth'
import { chooseImageWithPrivacy } from '../../src/utils/weapp-privacy'

jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(), getMyMembership: jest.fn(), showUnifiedApiError: jest.fn(),
}))
jest.mock('../../src/utils/withAuth', () => ({ redirectToLogin: jest.fn() }))
jest.mock('../../src/utils/membership', () => ({
  getFoodAnalysisCreditBlockMessage: jest.fn(() => ''), isFoodAnalysisCreditExhausted: jest.fn(() => false),
}))
jest.mock('../../src/components/iconfont', () => ({
  IconCamera: () => null, IconAlbum: () => null, IconText: () => null,
  IconFoodshop: () => null, IconChevronRight: () => null, IconTrendingUp: () => null,
}))
jest.mock('../../src/utils/dev-debug-tools', () => ({
  openAnalyzePageFromMenu: jest.fn(), openDebugAnalyzeLoadingFromMenu: jest.fn(),
  openDebugHealthProfileFromMenu: jest.fn(), openDebugRecordDetailPosterFromMenu: jest.fn(),
  openDebugResultPageFromMenu: jest.fn(),
}))
jest.mock('../../src/utils/dev-debug-storage', () => ({
  getDevDebugUiTestImageUrl: jest.fn(), setDevDebugUiTestImageUrl: jest.fn(),
}))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/components/CreditShortageSheet', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/DevNewUserOnboardingPreview', () => ({ DevNewUserOnboardingPreview: () => null }))
jest.mock('../../src/utils/weapp-privacy', () => ({
  chooseImageWithPrivacy: jest.fn(), isPrivacyAuthorizeError: jest.fn(() => false), showPrivacyAuthorizeFailure: jest.fn(),
}))

const storage = new Map<string, unknown>()
const dateSheet = () => Taro.showActionSheet as jest.Mock

async function clickImageEntry(mode: 'camera' | 'album', selectedDate: string) {
  const onClose = jest.fn()
  const view = render(<RecordMenu visible onClose={onClose} selectedDate={selectedDate} />)
  await act(async () => { fireEvent.click(view.container.querySelector(`#record-menu-guide-${mode}`)!) })
  await act(async () => { jest.advanceTimersByTime(80) })
  return { view, onClose }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 10, 10, 12))
  ;(globalThis as unknown as { __ENABLE_DEV_DEBUG_UI__: boolean }).__ENABLE_DEV_DEBUG_UI__ = false
  storage.clear()
  storage.set('recordTargetDate', '2026-11-08')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => storage.delete(key))
  ;(Taro.navigateTo as jest.Mock).mockResolvedValue({})
  ;(Taro as unknown as { showActionSheet: jest.Mock }).showActionSheet = jest.fn().mockResolvedValue({ tapIndex: 0 })
  ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
  ;(getMyMembership as jest.Mock).mockResolvedValue({})
  ;(chooseImageWithPrivacy as jest.Mock).mockResolvedValue({ tempFilePaths: ['wxfile://current-meal.jpg'] })
})

afterEach(() => { jest.useRealTimers() })

describe('record menu photo dates', () => {
  it.each(['camera', 'album'] as const)('%s defaults a new record to today even with a stale stored date', async (mode) => {
    const { onClose } = await clickImageEntry(mode, '2026-11-10')
    expect(Taro.showActionSheet).not.toHaveBeenCalled()
    expect(storage.get('recordTargetDate')).toBe('2026-11-10')
    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: `${mode === 'camera' ? '/packageCamera/pages/shoot/index' : '/packageExtra/pages/analyze/index'}?date=2026-11-10`,
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(chooseImageWithPrivacy).toHaveBeenCalledTimes(mode === 'album' ? 1 : 0)
  })

  it.each(['camera', 'album'] as const)('%s asks whether a browsed historical day is intended, and can record today', async (mode) => {
    dateSheet().mockResolvedValue({ tapIndex: 0 })
    await clickImageEntry(mode, '2026-11-08')
    expect(Taro.showActionSheet).toHaveBeenCalledWith({ itemList: ['记录今天', '补录11月8日'] })
    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: `${mode === 'camera' ? '/packageCamera/pages/shoot/index' : '/packageExtra/pages/analyze/index'}?date=2026-11-10`,
    })
    expect(storage.get('recordTargetDate')).toBe('2026-11-10')
  })

  it.each(['camera', 'album'] as const)('%s carries the past date only after an explicit backfill selection', async (mode) => {
    dateSheet().mockResolvedValue({ tapIndex: 1 })
    await clickImageEntry(mode, '2026-11-08')
    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: `${mode === 'camera' ? '/packageCamera/pages/shoot/index' : '/packageExtra/pages/analyze/index'}?date=2026-11-08&backfill=1`,
    })
    expect(storage.get('recordTargetDate')).toBe('2026-11-08')
  })

  it.each(['camera', 'album'] as const)('%s does nothing when the date choice is cancelled', async (mode) => {
    dateSheet().mockRejectedValue({ errMsg: 'showActionSheet:fail cancel' })
    const { onClose } = await clickImageEntry(mode, '2026-11-08')
    expect(Taro.navigateTo).not.toHaveBeenCalled()
    expect(chooseImageWithPrivacy).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(Taro.setStorageSync).not.toHaveBeenCalledWith('recordTargetDate', expect.anything())
  })

  it('still requires login before offering or opening a photo flow', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('')
    await clickImageEntry('camera', '2026-11-08')
    expect(redirectToLogin).toHaveBeenCalledTimes(1)
    expect(Taro.showActionSheet).not.toHaveBeenCalled()
    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })

  it('allows recording today while browsing a date outside the backfill window', async () => {
    dateSheet().mockResolvedValue({ tapIndex: 0 })
    await clickImageEntry('camera', '2020-01-01')
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageCamera/pages/shoot/index?date=2026-11-10' })
  })

  it('still rejects an expired day if the user explicitly chooses backfill', async () => {
    dateSheet().mockResolvedValue({ tapIndex: 1 })
    const { onClose } = await clickImageEntry('album', '2020-01-01')
    expect(Taro.navigateTo).not.toHaveBeenCalled()
    expect(chooseImageWithPrivacy).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(Taro.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '请重新选择日期，仅支持近14天记录' }))
  })

  it('uses the current day when the choice remains open across midnight', async () => {
    let choose!: (value: { tapIndex: number }) => void
    dateSheet().mockReturnValue(new Promise(resolve => { choose = resolve }))
    const view = render(<RecordMenu visible onClose={jest.fn()} selectedDate='2026-11-08' />)
    await act(async () => { fireEvent.click(view.container.querySelector('#record-menu-guide-camera')!) })
    jest.setSystemTime(new Date(2026, 10, 11, 0, 1))
    await act(async () => { choose({ tapIndex: 0 }) })
    await act(async () => { jest.advanceTimersByTime(80) })
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageCamera/pages/shoot/index?date=2026-11-11' })
  })

  it.each([
    ['text', '/packageExtra/pages/record-text/index'],
    ['manual', '/packageExtra/pages/record-manual/index'],
  ])('preserves the existing selected-date behavior for the %s entry', async (mode, url) => {
    const onClose = jest.fn()
    const view = render(<RecordMenu visible onClose={onClose} selectedDate='2026-11-08' />)
    await act(async () => { fireEvent.click(view.container.querySelector(`#record-menu-guide-${mode}`)!) })
    expect(Taro.showActionSheet).not.toHaveBeenCalled()
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: `${url}?date=2026-11-08` })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
