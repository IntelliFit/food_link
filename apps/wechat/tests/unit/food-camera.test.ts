import Taro from '@tarojs/taro'

import {
  FOOD_CAMERA_PAGE,
  openFoodCameraForResult,
  saveFoodCameraResult,
  takeFoodCameraResult,
} from '../../src/utils/food-camera'

const store = new Map<string, unknown>()

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getStorageSync: jest.fn(),
    setStorageSync: jest.fn(),
    removeStorageSync: jest.fn(),
    navigateTo: jest.fn(),
  },
}))

describe('food camera return mode', () => {
  beforeEach(() => {
    store.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => store.get(key) ?? '')
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => { store.set(key, value) })
    ;(Taro.removeStorageSync as jest.Mock).mockImplementation((key: string) => { store.delete(key) })
    ;(Taro.navigateTo as jest.Mock).mockReset().mockResolvedValue({})
  })

  it('opens the camera page in return mode and drops a stale result', async () => {
    saveFoodCameraResult(['wxfile://old.jpg'])
    await openFoodCameraForResult(3)
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: `${FOOD_CAMERA_PAGE}?return=1&max=3` })
    expect(takeFoodCameraResult()).toEqual([])
  })

  it('asks for at least one photo', async () => {
    await openFoodCameraForResult(0)
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: `${FOOD_CAMERA_PAGE}?return=1&max=1` })
  })

  it('hands the shot back once', () => {
    saveFoodCameraResult(['wxfile://a.jpg', ' ', 'wxfile://b.jpg'])
    expect(takeFoodCameraResult()).toEqual(['wxfile://a.jpg', 'wxfile://b.jpg'])
    expect(takeFoodCameraResult()).toEqual([])
  })

  it('returns nothing when the user backed out without shooting', () => {
    expect(takeFoodCameraResult()).toEqual([])
  })
})
