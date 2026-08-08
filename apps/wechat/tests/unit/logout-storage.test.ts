import Taro from '@tarojs/taro'
import { clearAllStorage } from '../../src/utils/api'

describe('logout storage cleanup', () => {
  it('removes the cached home dashboard to prevent cross-account calendar data', () => {
    clearAllStorage()

    expect(Taro.removeStorageSync).toHaveBeenCalledWith('home_dashboard_local_cache')
  })
})
