import Taro from '@tarojs/taro'
import {
  BALANCED_THEME_DEFINITIONS,
  BALANCED_THEME_STORAGE_KEY,
  DEFAULT_BALANCED_THEME,
  getBalancedThemeDefinition,
  getStoredBalancedTheme,
  isBalancedThemeId,
  setStoredBalancedTheme,
} from '../../src/utils/balanced-theme'

describe('balanced visual themes', () => {
  const getStorageSync = Taro.getStorageSync as jest.Mock
  const setStorageSync = Taro.setStorageSync as jest.Mock

  beforeEach(() => {
    getStorageSync.mockReset()
    setStorageSync.mockReset()
  })

  it('defines eight distinct themes and toolbox metaphors', () => {
    expect(BALANCED_THEME_DEFINITIONS).toHaveLength(8)
    expect(new Set(BALANCED_THEME_DEFINITIONS.map((theme) => theme.id)).size).toBe(8)
    expect(new Set(BALANCED_THEME_DEFINITIONS.map((theme) => theme.toolboxLabel)).size).toBe(8)
    expect(BALANCED_THEME_DEFINITIONS.some((theme) => theme.toolboxLabel.includes('葫芦'))).toBe(false)
  })

  it('reads a supported stored theme and falls back from invalid values', () => {
    getStorageSync.mockReturnValueOnce('way-of-water')
    expect(getStoredBalancedTheme()).toBe('way-of-water')

    getStorageSync.mockReturnValueOnce('yin-yang')
    expect(getStoredBalancedTheme()).toBe(DEFAULT_BALANCED_THEME)
    expect(isBalancedThemeId('yin-yang')).toBe(false)
  })

  it('persists theme selection and resolves its definition', () => {
    setStoredBalancedTheme('modern-gallery')
    expect(setStorageSync).toHaveBeenCalledWith(BALANCED_THEME_STORAGE_KEY, 'modern-gallery')
    expect(getBalancedThemeDefinition('modern-gallery').name).toBe('现代艺廊')
  })
})
