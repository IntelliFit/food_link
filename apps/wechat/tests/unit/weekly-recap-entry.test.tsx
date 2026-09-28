import { fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { WeeklyRecapEntry } from '../../src/components/WeeklyRecapEntry'
import { getAccessToken } from '../../src/utils/api'
import { redirectToLogin } from '../../src/utils/withAuth'

jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(),
}))

jest.mock('../../src/utils/withAuth', () => ({
  redirectToLogin: jest.fn(),
}))

describe('weekly recap entry', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-28T12:00:00Z'))
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('uses a meaningful trend icon and a compact completed-week summary', () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('account-token')

    render(<WeeklyRecapEntry />)

    expect(screen.getByText('上周回顾')).toBeInTheDocument()
    expect(screen.getByText('09.21 — 09.27')).toBeInTheDocument()
    expect(screen.getByText('回看饮食、饮水与记录天数')).toBeInTheDocument()
    expect(screen.queryByText('周')).not.toBeInTheDocument()
    expect(document.querySelector('.weekly-recap-entry__icon .icon-shangzhang')).toBeInTheDocument()
  })

  it('opens the recap for signed-in users', () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('account-token')
    render(<WeeklyRecapEntry />)

    fireEvent.click(screen.getByRole('button', { name: /上周回顾/ }))

    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageRecap/pages/recap/index' })
    expect(redirectToLogin).not.toHaveBeenCalled()
  })

  it('keeps the existing login guard', () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('')
    render(<WeeklyRecapEntry />)

    fireEvent.click(screen.getByRole('button', { name: /上周回顾/ }))

    expect(redirectToLogin).toHaveBeenCalledTimes(1)
    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })
})
