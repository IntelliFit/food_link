import Taro from '@tarojs/taro'
import { applyThemeNavigationBar } from '../../src/utils/theme-navigation-bar'

jest.mock('../../src/utils/balanced-theme', () => ({ getStoredBalancedTheme: () => 'way-of-water' }))
describe('dark artwork navigation contrast', () => {
  beforeEach(() => { (Taro as any).setNavigationBarColor = jest.fn(); (Taro.getStorageSync as jest.Mock).mockReturnValue('balanced') })
  it('uses white system text on a dark balanced tab', () => {
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'pages/index/index' }])
    applyThemeNavigationBar('light')
    expect(Taro.setNavigationBarColor).toHaveBeenCalledWith(expect.objectContaining({ frontColor: '#ffffff', backgroundColor: '#07111a' }))
  })
  it('does not leak a dark artwork theme into login or wellness', () => {
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'packageExtra/pages/login/index' }])
    applyThemeNavigationBar('light')
    expect(Taro.setNavigationBarColor).toHaveBeenLastCalledWith(expect.objectContaining({ frontColor: '#000000' }))
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'pages/index/index' }])
    ;(Taro.getStorageSync as jest.Mock).mockReturnValue('wellness')
    applyThemeNavigationBar('light')
    expect(Taro.setNavigationBarColor).toHaveBeenLastCalledWith(expect.objectContaining({ frontColor: '#000000', backgroundColor: '#f7f3e8' }))
  })
})
