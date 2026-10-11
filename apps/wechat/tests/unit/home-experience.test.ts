import Taro from '@tarojs/taro'
import {
  getStoredHomeExperienceConfig,
  saveHomeExperienceConfig,
} from '../../src/utils/home-experience'

describe('home experience mode storage', () => {
  const getStorageSync = Taro.getStorageSync as jest.Mock
  const setStorageSync = Taro.setStorageSync as jest.Mock

  beforeEach(() => {
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([])
    getStorageSync.mockReset()
    setStorageSync.mockReset()
    getStorageSync.mockImplementation((key: string) => {
      if (key === 'user_id') return 'user-1'
      if (key === 'home_experience_config_v2:user-1') {
        return { version: 2, mode: 'wellness' }
      }
      return undefined
    })
  })

  it('syncs the stored mode to the custom tab bar key on initialization', () => {
    expect(getStoredHomeExperienceConfig()).toEqual({ version: 2, mode: 'wellness' })
    expect(setStorageSync).toHaveBeenCalledWith('home_display_mode_v1', 'wellness')
  })

  it('syncs mode changes to both the user config and custom tab bar key', () => {
    expect(saveHomeExperienceConfig({ version: 2, mode: 'balanced' })).toEqual({
      version: 2,
      mode: 'balanced',
    })
    expect(setStorageSync).toHaveBeenCalledWith(
      'home_experience_config_v2:user-1',
      { version: 2, mode: 'balanced' },
    )
    expect(setStorageSync).toHaveBeenCalledWith('home_display_mode_v1', 'balanced')
  })
  it('updates mounted native tab bars immediately in both directions without page show', () => {
    const first = jest.fn()
    const second = jest.fn()
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([
      { getTabBar: () => ({ setData: first }) },
      { getTabBar: () => { throw new Error('disposed page') } },
      { getTabBar: () => ({ setData: second }) },
    ])
    saveHomeExperienceConfig({ version: 2, mode: 'wellness' })
    expect(first).toHaveBeenLastCalledWith({ wellnessActive: true })
    expect(second).toHaveBeenLastCalledWith({ wellnessActive: true })
    saveHomeExperienceConfig({ version: 2, mode: 'balanced' })
    expect(first).toHaveBeenLastCalledWith({ wellnessActive: false })
    expect(second).toHaveBeenLastCalledWith({ wellnessActive: false })
  })

})
