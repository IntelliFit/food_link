import Taro from '@tarojs/taro'
import { completeModeIntroduction, getModeIntroductionSession, MODE_INTRODUCTION_PREFIX } from '../../src/utils/mode-introduction'
import { saveHomeExperienceConfig } from '../../src/utils/home-experience'
import { clearAllStorage } from '../../src/utils/api'
import { BALANCED_THEME_IDS, BALANCED_THEME_STORAGE_KEY, getBalancedThemeStorageKey, getStoredBalancedTheme, setStoredBalancedTheme } from '../../src/utils/balanced-theme'

let store: Record<string, any>
beforeEach(() => {
  jest.clearAllMocks()
  store = { user_id: 'a', access_token: 'session-a' }
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => store[key])
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => { store[key] = value })
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => { delete store[key] })
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([])
})

test('a default or previously configured mode is not a completed introduction; only authenticated accounts are gated', () => {
  expect(getModeIntroductionSession().required).toBe(true)
  store['home_experience_config_v2:a'] = { version: 2, mode: 'wellness' }
  expect(getModeIntroductionSession().required).toBe(true)
  expect(store[`${MODE_INTRODUCTION_PREFIX}a`]).toBeUndefined()
  delete store.access_token
  expect(getModeIntroductionSession().required).toBe(false)
})

test.each(['balanced', 'wellness'] as const)('final %s confirmation persists the explicit choice and native tabbar immediately', mode => {
  const tabbar = jest.fn()
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ getTabBar: () => ({ setData: tabbar }) }])
  expect(completeModeIntroduction(mode, getModeIntroductionSession())).toBe(true)
  expect(store['home_experience_config_v2:a']).toEqual({ version: 2, mode })
  expect(store[`${MODE_INTRODUCTION_PREFIX}a`]).toEqual({ version: 1, completed: true })
  expect(store.home_display_mode_v1).toBe(mode)
  expect(tabbar).toHaveBeenLastCalledWith({ wellnessActive: mode === 'wellness' })
  expect(getModeIntroductionSession().required).toBe(false)
})

test('logout and same-account login retain the confirmed default; another account still needs its own choice', () => {
  completeModeIntroduction('wellness', getModeIntroductionSession())
  clearAllStorage()
  expect(getModeIntroductionSession().required).toBe(false)
  store.user_id = 'a'; store.access_token = 'session-a2'
  expect(getModeIntroductionSession().required).toBe(false)
  expect(store['home_experience_config_v2:a'].mode).toBe('wellness')
  store.user_id = 'b'; store.access_token = 'session-b'
  expect(getModeIntroductionSession().required).toBe(true)
  expect(store[`${MODE_INTRODUCTION_PREFIX}b`]).toBeUndefined()
})

test('stale account/session confirmations never write to the new account', () => {
  const old = getModeIntroductionSession()
  store.user_id = 'b'; store.access_token = 'session-b'
  expect(completeModeIntroduction('wellness', old)).toBe(false)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  store.user_id = 'a'; store.access_token = 'session-a2'
  expect(completeModeIntroduction('wellness', old)).toBe(false)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('a failed completion write rolls back the preview and leaves introduction pending', () => {
  store['home_experience_config_v2:a'] = { version: 2, mode: 'balanced' }
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => {
    if (key.startsWith(MODE_INTRODUCTION_PREFIX)) throw Error('storage full')
    store[key] = value
  })
  expect(completeModeIntroduction('wellness', getModeIntroductionSession())).toBe(false)
  expect(getModeIntroductionSession().required).toBe(true)
  expect(store['home_experience_config_v2:a'].mode).toBe('balanced')
  expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
})

test('profile mode changes keep the completed introduction and the selected balanced visual theme', () => {
  store.balanced_visual_theme_v1 = 'way-of-water'
  completeModeIntroduction('wellness', getModeIntroductionSession())
  saveHomeExperienceConfig({ version: 2, mode: 'balanced' })
  expect(getModeIntroductionSession().required).toBe(false)
  expect(store.balanced_visual_theme_v1).toBe('way-of-water')
  delete store['home_experience_config_v2:a']
  expect(getModeIntroductionSession().required).toBe(true)
})

test.each(BALANCED_THEME_IDS)('confirms the %s theme together with balanced mode', theme => {
  expect(completeModeIntroduction({ mode: 'balanced', theme }, getModeIntroductionSession())).toBe(true)
  expect(store[getBalancedThemeStorageKey('a')]).toBe(theme)
  expect(store[BALANCED_THEME_STORAGE_KEY]).toBe(theme)
  expect(store['home_experience_config_v2:a'].mode).toBe('balanced')
  expect(getModeIntroductionSession().required).toBe(false)
})

test.each(['home_experience_config_v2:a', 'balanced_visual_theme_v1:a', BALANCED_THEME_STORAGE_KEY, `${MODE_INTRODUCTION_PREFIX}a`])('rolls back all preferences if %s fails or silently ignores a write', key => {
  for (const silent of [false, true]) {
    jest.clearAllMocks()
    store = { user_id: 'a', access_token: 'session-a', 'home_experience_config_v2:a': { version: 2, mode: 'wellness' }, 'balanced_visual_theme_v1:a': 'eastern-salon', [BALANCED_THEME_STORAGE_KEY]: 'eastern-salon' }
    const before = { ...store }
    let failed = false
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((name, value) => {
      if (name === key && !failed) { failed = true; if (!silent) throw Error('storage full'); return }
      store[name] = value
    })
    expect(completeModeIntroduction({ mode: 'balanced', theme: 'way-of-water' }, getModeIntroductionSession())).toBe(false)
    expect(store).toEqual(before)
    expect(getModeIntroductionSession().required).toBe(true)
    expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
  }
})

test('confirmed account themes survive another account and later profile changes', () => {
  completeModeIntroduction({ mode: 'balanced', theme: 'way-of-water' }, getModeIntroductionSession())
  store.user_id = 'b'; store.access_token = 'session-b'
  completeModeIntroduction({ mode: 'balanced', theme: 'modern-gallery' }, getModeIntroductionSession())
  store.user_id = 'a'; store.access_token = 'session-a2'
  expect(getModeIntroductionSession().required).toBe(false)
  expect(getStoredBalancedTheme()).toBe('way-of-water')
  setStoredBalancedTheme('picturebook-companion')
  store.user_id = 'b'
  expect(getStoredBalancedTheme()).toBe('modern-gallery')
  store.user_id = 'a'
  expect(getStoredBalancedTheme()).toBe('picturebook-companion')
})

test('legacy completion is accepted without a new theme field, and mirror failure does not lose the account theme', () => {
  store[`${MODE_INTRODUCTION_PREFIX}a`] = { version: 1, completed: true }
  store['home_experience_config_v2:a'] = { version: 2, mode: 'wellness' }
  expect(getModeIntroductionSession().required).toBe(false)
  store[getBalancedThemeStorageKey('a')] = 'way-of-water'
  ;(Taro.setStorageSync as jest.Mock).mockImplementation(() => { throw Error('quota') })
  expect(getStoredBalancedTheme()).toBe('way-of-water')
})

test('a stale balanced confirmation cannot mutate even the global theme mirror', () => {
  const previous = getModeIntroductionSession()
  store.user_id = 'b'; store.access_token = 'session-b'
  expect(completeModeIntroduction({ mode: 'balanced', theme: 'way-of-water' }, previous)).toBe(false)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})
