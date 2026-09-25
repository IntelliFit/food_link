import { fireEvent, render, screen } from '@testing-library/react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { RecapDelivery } from '../../src/components/RecapDelivery'
import { getAccessToken } from '../../src/utils/api'

jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(),
  getStatsCalendarMonth: jest.fn(),
}))
jest.mock('../../src/components/RecapCelebration', () => ({ RecapCelebration: () => null }))

test('archive opens the dedicated recap page so native preview returns to the report route', () => {
  ;(useDidShow as jest.Mock).mockImplementation(() => undefined)
  ;(useDidHide as jest.Mock).mockImplementation(() => undefined)
  ;(getAccessToken as jest.Mock).mockReturnValue('token-a')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => {
    if (key === 'user_id') return 'account-a'
    if (key === 'period-recaps-v1:account-a') return [{
      kind: 'week', anchor: '2026-09-21', start: '2026-09-14', end: '2026-09-20', id: 'week:2026-09-14',
    }]
    return null
  })

  render(<RecapDelivery archive />)
  expect(screen.getByText('食探书架')).toBeInTheDocument()
  fireEvent.click(screen.getByText('食探书架'))
  expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageRecap/pages/recap/index' })
})
