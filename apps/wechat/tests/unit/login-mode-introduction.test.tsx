import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import LoginPage from '../../src/packageExtra/pages/login/index'
import { MODE_INTRODUCTION_PREFIX } from '../../src/utils/mode-introduction'
import { getUserProfile } from '../../src/utils/api'

let mockStore: Record<string, any>
let mockOnboardingCompleted = true
jest.mock('../../src/utils/api', () => ({
  getPublicConfig: jest.fn(async () => ({ allow_debug_register: false })),
  getWeappEnvVersion: () => 'release',
  getAccessToken: () => mockStore.access_token || '',
  login: jest.fn(async () => {
    mockStore.user_id = 'user-a'; mockStore.access_token = 'session-a'
    return { user_id: 'user-a', openid: 'openid-a', purePhoneNumber: '13000000000' }
  }),
  getUserProfile: jest.fn(async () => ({ nickname: '食探用户', avatar: 'https://example.test/avatar.png', onboarding_completed: mockOnboardingCompleted })),
}))
jest.mock('../../src/components/FlPageThemeRoot', () => ({ FlPageThemeRoot: ({ children }: any) => <>{children}</> }))
jest.mock('../../src/components/NewUserOnboardingModals', () => ({ NewUserOnboardingModals: () => null }))
jest.mock('../../src/utils/weapp-user-files', () => ({ cleanupGeneratedUserFiles: jest.fn(async () => undefined) }))
jest.mock('../../src/utils/static-asset-cdn-url', () => ({ DEFAULT_AVATAR_URL: 'https://example.test/default.png', LOGIN_LOGO_URL: 'https://example.test/logo.png' }))
jest.mock('@taroify/core', () => ({ Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button> }))
jest.mock('@taroify/core/button/style', () => ({}))
jest.mock('../../src/components/ModeIntroMedia', () => ({ ModeIntroMedia: () => null }))
jest.mock('../../src/components/ModeIntroArtwork', () => ({ ModeIntroArtwork: () => null }))

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Image: () => null, Input: () => null, PageMeta: () => null,
    Button: ({ children, onGetPhoneNumber, onClick, disabled, id, loading: _loading, ...props }: any) => React.createElement('button', { ...props, id, disabled, onClick: onGetPhoneNumber ? () => onGetPhoneNumber({ detail: { code: 'phone-code' } }) : onClick }, children),
    ScrollView: ({ children }: any) => React.createElement('div', {}, children),
    SwiperItem: ({ children }: any) => React.createElement('div', {}, children),
    Swiper: ({ children, current }: any) => React.createElement('div', {}, React.Children.toArray(children)[current]),
  }
})

const listeners = new Map<string, Set<() => void>>()
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); listeners.clear()
  mockStore = {}; mockOnboardingCompleted = true
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => mockStore[key])
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => { mockStore[key] = value })
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => { delete mockStore[key] })
  ;(Taro.login as jest.Mock).mockResolvedValue({ code: 'wechat-code' })
  ;(Taro.navigateTo as jest.Mock).mockResolvedValue(undefined)
  ;(Taro.redirectTo as jest.Mock).mockResolvedValue(undefined)
  ;(Taro.switchTab as jest.Mock).mockResolvedValue(undefined)
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'packageExtra/pages/login/index' }])
  ;(Taro.eventCenter.on as jest.Mock).mockImplementation((name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name)!.add(fn)
  })
  ;(Taro.eventCenter.off as jest.Mock).mockImplementation((name, fn) => listeners.get(name)?.delete(fn))
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementation(name => listeners.get(name)?.forEach(fn => fn()))
  ;(useDidShow as jest.Mock).mockImplementation(() => undefined)
  ;(useRouter as jest.Mock).mockReturnValue({ params: {} })
})
afterEach(() => jest.useRealTimers())

async function logIn() {
  const view = render(<LoginPage />)
  fireEvent.click(view.container.querySelector('.agreement-row')!)
  await act(async () => { fireEvent.click(screen.getByText('手机号快捷登录')) })
  return view
}
async function continueTimer() { await act(async () => { jest.advanceTimersByTime(1600) }) }
async function choose() {
  for (let i = 0; i < 10; i++) fireEvent.click(document.querySelector('#mode-introduction-next')!)
  fireEvent.click(screen.getByRole('button', { name: '选择养生模式·阴阳主题' }))
  await act(async () => { fireEvent.click(document.querySelector('#mode-introduction-next')!) })
}

test('first login introduces both modes before the unfinished health-profile gate', async () => {
  mockOnboardingCompleted = false
  await logIn(); await continueTimer()
  expect(document.querySelector('#mode-introduction')).toBeInTheDocument()
  expect(Taro.navigateTo).not.toHaveBeenCalled()
  expect(Taro.switchTab).not.toHaveBeenCalled()
  await choose()
  expect(mockStore[`${MODE_INTRODUCTION_PREFIX}user-a`]?.completed).toBe(true)
  expect(Taro.navigateTo).toHaveBeenCalledTimes(1)
  expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/health-profile/index' })
})

test('confirmation preserves the original deep-link return including its query; later login skips the choice', async () => {
  const target = '/packageExtra/pages/record-text/index?date=2026-10-15'
  ;(useRouter as jest.Mock).mockReturnValue({ params: { redirect: encodeURIComponent(target) } })
  const first = await logIn(); await continueTimer(); await choose()
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: target })
  first.unmount()
  ;(Taro.redirectTo as jest.Mock).mockClear()
  await logIn(); await continueTimer()
  expect(document.querySelector('#mode-introduction')).toBeNull()
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: target })
})

test('a delayed login continuation cannot start another account introduction or navigate using old onboarding state', async () => {
  await logIn()
  mockStore.user_id = 'user-b'; mockStore.access_token = 'session-b'
  await continueTimer()
  expect(document.querySelector('#mode-introduction')).toBeNull()
  expect(Taro.navigateTo).not.toHaveBeenCalled()
  expect(Taro.switchTab).not.toHaveBeenCalled()
  expect(Taro.redirectTo).not.toHaveBeenCalled()
})

test('an old account profile response cannot replace a newly active account or start its introduction', async () => {
  let resolve!: (profile: unknown) => void
  ;(getUserProfile as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await logIn()
  mockStore.user_id = 'user-b'; mockStore.access_token = 'session-b'; mockStore.userInfo = { name: '保留用户B' }
  await act(async () => { resolve({ nickname: '用户A', avatar: 'https://example.test/a.png', onboarding_completed: false }) })
  await continueTimer()
  expect(mockStore.userInfo).toEqual({ name: '保留用户B' })
  expect(document.querySelector('#mode-introduction')).toBeNull()
  expect(Taro.navigateTo).not.toHaveBeenCalled()
  expect(Taro.switchTab).not.toHaveBeenCalled()
})
