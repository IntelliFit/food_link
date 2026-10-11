import Taro from '@tarojs/taro'
import { redirectToLogin } from '../../src/utils/withAuth'
import { extraPkgUrl } from '../../src/utils/subpackage-extra'

jest.mock('../../src/utils/api', () => ({ getAccessToken: jest.fn() }))
beforeEach(() => jest.clearAllMocks())

test('uses the registered login subpackage and preserves record date query for returning', () => {
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'packageExtra/pages/record-text/index', options: { date: '2026-10-09' } }])
  redirectToLogin()
  const url = `${extraPkgUrl('/pages/login/index')}?redirect=${encodeURIComponent('/packageExtra/pages/record-text/index?date=2026-10-09')}`
  expect(Taro.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url }))
  const options = (Taro.navigateTo as jest.Mock).mock.calls[0][0]
  options.fail()
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url })
})

test('preserves an explicit return target and avoids recursive login navigation', () => {
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'packageExtra/pages/exercise-record/index', options: {} }])
  redirectToLogin('/packageExtra/pages/exercise-record/index?date=2026-10-09')
  expect(Taro.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
    url: `${extraPkgUrl('/pages/login/index')}?redirect=${encodeURIComponent('/packageExtra/pages/exercise-record/index?date=2026-10-09')}`
  }))
  ;(Taro.navigateTo as jest.Mock).mockClear()
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'packageExtra/pages/login/index', options: {} }])
  redirectToLogin()
  expect(Taro.navigateTo).not.toHaveBeenCalled()
})
