import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import ProfilePage from '../../src/pages/profile/index'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: unknown) => Component, redirectToLogin: jest.fn() }))
jest.mock('../../src/components/InkWellness', () => ({ useInkWellness: () => false, InkMasthead: () => null }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/components/BalancedThemeExperience', () => ({ BalancedThemeExperience: ({ children }: { children: unknown }) => children }))
jest.mock('../../src/components/ThemeProfileSection', () => ({ ThemeProfileSection: ({ children }: { children: unknown }) => children }))
jest.mock('../../src/components/RecapDelivery', () => ({ RecapDelivery: () => null }))
jest.mock('../../src/components/BalancedThemePicker', () => ({ BalancedThemeEntry: () => null, BalancedThemePicker: () => null }))
jest.mock('../../src/utils/api', () => ({ getAccessToken: jest.fn(() => ''), clearRecentRequestTraces: jest.fn() }))
jest.mock('../../src/utils/weapp-user-files', () => ({ cleanupGeneratedUserFiles: jest.fn().mockResolvedValue(undefined) }))
jest.mock('../../src/utils/onboarding-guide-storage', () => ({ clearAllOnboardingGuides: jest.fn() }))
jest.mock('../../src/utils/console-log-buffer', () => ({ clearRecentConsoleLogs: jest.fn() }))

let store: Map<string, unknown>
beforeEach(() => {
  jest.clearAllMocks()
  ;(Taro.useDidShow as jest.Mock).mockImplementation(() => undefined)
  store = new Map()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => store.get(key))
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation((key: string) => store.delete(key))
  Object.assign(Taro, { getStorageInfoSync: jest.fn(() => ({ keys: [...store.keys()], currentSize: 1, limitSize: 10240 })) })
})

test('the actual clear-cache action removes reloadable caches while preserving every account pet save and v1 recovery copy', async () => {
  const prefixes = ['pet_growth_v2:', 'pet_loadout_v2:', 'pet_transport_v1:', 'pet_adventure_progress_v1:', 'pet_studio_dressing_v1:', 'pet_kitchen_best_v1:']
  const preserved = new Map<string, unknown>()
  for (const account of ['user-a', 'user-b']) for (const prefix of prefixes) {
    const key = `${prefix}${account}:pet:appearance`
    const value = { version: prefix.includes('v2') ? 2 : 1, saved: key }
    preserved.set(key, value); store.set(key, value)
  }
  preserved.set('pet_kitchen_best_v1:user-a', { version: 1, levels: { '1': { score: 900, stars: 3, served: 8 } } })
  preserved.set('user_id', 'user-a')
  for (const [key, value] of preserved) store.set(key, value)
  const caches = ['home_dashboard_local_cache', 'community_feed_cache', 'analyzeResult', 'comment_draft_post-one']
  for (const key of caches) store.set(key, 'stale cache')
  ;(Taro.showModal as jest.Mock).mockImplementation((options: { success: (result: { confirm: boolean; cancel: boolean }) => Promise<void> }) => options.success({ confirm: true, cancel: false }))
  render(<ProfilePage />)
  await act(async () => { fireEvent.click(screen.getByText('清除缓存')) })
  await waitFor(() => expect(Taro.showToast).toHaveBeenCalledWith({ title: '缓存已清除', icon: 'success' }))
  expect(Taro.showModal).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('宠物成长、收藏、衣装和游戏成绩会保留') }))
  for (const [key, value] of preserved) expect(store.get(key)).toEqual(value)
  for (const key of caches) expect(store.has(key)).toBe(false)
  expect((Taro.removeStorageSync as jest.Mock).mock.calls.map(([key]) => key).some(key => prefixes.some(prefix => String(key).startsWith(prefix)))).toBe(false)
})

test('cancelling the clear-cache confirmation keeps both game saves and ordinary cache data', async () => {
  store.set('pet_growth_v2:user-a', { version: 2, stars: 30 })
  store.set('home_dashboard_local_cache', 'cached dashboard')
  ;(Taro.showModal as jest.Mock).mockImplementation((options: { success: (result: { confirm: boolean; cancel: boolean }) => Promise<void> }) => options.success({ confirm: false, cancel: true }))
  render(<ProfilePage />)
  await act(async () => { fireEvent.click(screen.getByText('清除缓存')) })
  expect(Taro.removeStorageSync).not.toHaveBeenCalled()
  expect(store.get('pet_growth_v2:user-a')).toEqual({ version: 2, stars: 30 })
  expect(store.get('home_dashboard_local_cache')).toBe('cached dashboard')
})
