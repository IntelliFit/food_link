import { act, fireEvent, render, screen } from '@testing-library/react'
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

describe('record menu inherits the selected calendar day', () => {
  it.each(['camera', 'album'] as const)('%s records the selected past day without another date-choice menu', async mode => {
    await clickImageEntry(mode, '2026-11-08')
    expect(Taro.showActionSheet).not.toHaveBeenCalled()
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: `${mode === 'camera' ? '/packageCamera/pages/shoot/index' : '/packageExtra/pages/analyze/index'}?date=2026-11-08&backfill=1` })
    expect(storage.get('recordTargetDate')).toBe('2026-11-08')
  })
  it.each(['camera', 'album'] as const)('%s follows the visible today instead of stale storage', async mode => {
    await clickImageEntry(mode, '2026-11-10')
    expect(Taro.showActionSheet).not.toHaveBeenCalled()
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: `${mode === 'camera' ? '/packageCamera/pages/shoot/index' : '/packageExtra/pages/analyze/index'}?date=2026-11-10` })
  })
  it.each(['2020-01-01', '2026-11-11', 'bad'])('rejects %s instead of silently recording today', async date => {
    await clickImageEntry('camera', date)
    expect(Taro.navigateTo).not.toHaveBeenCalled()
    expect(Taro.showToast).toHaveBeenCalled()
  })
  it('requires login before recording', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('')
    await clickImageEntry('camera', '2026-11-08')
    expect(redirectToLogin).toHaveBeenCalledTimes(1)
    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })
  it.each([['text','record-text'], ['manual','record-manual']])('preserves the same date for %s', async (mode,page) => {
    const view=render(<RecordMenu visible onClose={jest.fn()} selectedDate='2026-11-08' />)
    await act(async()=>{fireEvent.click(view.container.querySelector(`#record-menu-guide-${mode}`)! )})
    expect(Taro.navigateTo).toHaveBeenCalledWith({url:`/packageExtra/pages/${page}/index?date=2026-11-08`})
  })
  it.each([['我的收藏','recipes'], ['识别记录','analyze-history']])('passes the target day through %s', async (label, page) => {
    render(<RecordMenu visible onClose={jest.fn()} selectedDate='2026-11-08' />)
    await act(async () => { fireEvent.click(screen.getByText(label)) })
    expect(Taro.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/packageExtra/pages/${page}/index?date=2026-11-08` }))
  })
})
