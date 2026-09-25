jest.mock('../../src/components/RecapMusic', () => ({ RecapMusic: () => null }))
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HealthRecap } from '../../src/components/HealthRecap'
import { getAccessToken, getStatsCalendarMonth, getBodyMetricsSummary, getFoodRecordList } from '../../src/utils/api'
import { recapPeriod } from '../../src/utils/health-recap'

jest.mock('../../src/utils/api', () => ({
  getStatsSummary: jest.fn().mockResolvedValue(null), getUserProfile: jest.fn().mockResolvedValue({nickname: '测试用户'}), getAccessToken: jest.fn(), getStatsCalendarMonth: jest.fn(), getBodyMetricsSummary: jest.fn(), getFoodRecordList: jest.fn(),
}))
jest.mock('../../src/utils/withAuth', () => ({ redirectToLogin: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(getAccessToken as jest.Mock).mockReturnValue('account-a')
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async (month: string) => ({
    days: recapPeriod('week', new Date().getFullYear()).dates.filter(date => date.startsWith(month)).map(date => ({ date, calories: 1000, has_record: true })),
  }))
  ;(getBodyMetricsSummary as jest.Mock).mockResolvedValue({ water_daily: [], weight_entries: [] })
  ;(getFoodRecordList as jest.Mock).mockResolvedValue({ records: [] })
})

test('active state changes preserve the story and account changes clear it', async () => {
  const { rerender } = render(<HealthRecap active />)
  fireEvent.click(screen.getByText('开始这段旅程'))
  expect(screen.queryByText('尊敬的测试用户：')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: '点击轻轻拆开我的周报' }))
  await screen.findByText('尊敬的测试用户：')
  expect(document.querySelector('.journal-v5--0.is-current .journal-v5__cover-letter')).not.toBeNull()
  expect(screen.getByRole('button', { name: '收下这封信，继续回忆' })).toBeInTheDocument()
  const calls = (getStatsCalendarMonth as jest.Mock).mock.calls.length
  rerender(<HealthRecap active={false} />)
  rerender(<HealthRecap active />)
  expect(screen.getByText('尊敬的测试用户：')).toBeInTheDocument()
  expect(getStatsCalendarMonth).toHaveBeenCalledTimes(calls)
  ;(getAccessToken as jest.Mock).mockReturnValue('account-b')
  rerender(<HealthRecap active={false} />)
  rerender(<HealthRecap active />)
  expect(screen.getByText('开始这段旅程')).toBeInTheDocument()
  expect(screen.queryByText('记录冒险家')).toBeNull()
})

test('a cross-year week requests both years instead of dropping January records', async () => {
  const period = recapPeriod('week', 2020, new Date('2021-01-04T12:00:00'))
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async (month: string) => ({ days: period.dates.filter(date => date.startsWith(month)).map(date => ({ date, calories: 0, has_record: false })) }))
  ;(getBodyMetricsSummary as jest.Mock).mockImplementation(async (_range: string, year: number) => ({ start_date: `${year}-01-01`, end_date: `${year}-12-31`, water_daily: [], weight_entries: [] }))
  render(<HealthRecap active selection={{ kind: 'week', anchor: '2021-01-04' }} />)
  await screen.findByRole('button', { name: '点击轻轻拆开我的周报' })
  expect(getBodyMetricsSummary).toHaveBeenCalledWith('year', 2020)
  expect(getBodyMetricsSummary).toHaveBeenCalledWith('year', 2021)
})

test('failed initial request offers retry rather than fabricating a report', async () => {
  ;(getStatsCalendarMonth as jest.Mock).mockRejectedValueOnce(new Error('network'))
  render(<HealthRecap active />)
  fireEvent.click(screen.getByText('开始这段旅程'))
  await screen.findByText(/本次更新未完成/)
  fireEvent.click(screen.getByText('重新打开'))
  await screen.findByRole('button', { name: '点击轻轻拆开我的周报' })
})

test('switching report while a request runs prevents a late result from replacing the selected report', async () => {
  let finish: (value: unknown) => void = () => undefined
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<HealthRecap active />)
  fireEvent.click(screen.getByText('开始这段旅程'))
  fireEvent.click(screen.getByText('去年'))
  finish({ days: [] })
  await waitFor(() => expect(screen.getByText('开始这段旅程')).toBeInTheDocument())
  expect(screen.queryByText('尊敬的测试用户：')).toBeNull()
})
