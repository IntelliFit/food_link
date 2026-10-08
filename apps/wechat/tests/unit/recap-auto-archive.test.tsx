import { render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { HealthRecap } from '../../src/components/HealthRecap'
import { getStatsCalendarMonth } from '../../src/utils/api'
import { recapPeriod } from '../../src/utils/health-recap'

jest.mock('../../src/components/RecapMusic', () => ({ RecapMusic: () => null }))
jest.mock('../../src/utils/withAuth', () => ({ redirectToLogin: jest.fn() }))
jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(() => 'token-a'), getStatsCalendarMonth: jest.fn(),
  getUserProfile: jest.fn().mockResolvedValue({ nickname: '读者', id: 'reader-a' }),
  getStatsSummary: jest.fn().mockResolvedValue(null),
  getBodyMetricsSummary: jest.fn().mockResolvedValue({ water_daily: [], weight_entries: [] }),
  communityGetFeed: jest.fn().mockResolvedValue({ list: [] }), normalizeCommunityFeedItem: jest.fn(),
}))
let storage: Map<string, unknown>
beforeEach(() => {
  jest.clearAllMocks(); storage = new Map()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === 'user_id' ? 'reader-a' : storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  const period = recapPeriod('week', 2026, new Date('2026-09-28T12:00:00'))
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async month => ({ days: period.dates.filter(date => date.startsWith(month)).map(date => ({ date, calories: 0, has_record: true })) }))
})

test('a successfully opened report is archived even when delivery popups are paused', async () => {
  render(<HealthRecap active selection={{ kind: 'week', anchor: '2026-09-28' }} />)
  await screen.findByRole('button', { name: '点击轻轻拆开我的周报' })
  expect(storage.get('period-recaps-v1:reader-a')).toEqual([{ id: 'week:2026-09-21', kind: 'week', anchor: '2026-09-28', start: '2026-09-21', end: '2026-09-27' }])
  expect(Taro.setStorageSync).not.toHaveBeenCalledWith(expect.stringContaining('recap-book-marks'), expect.anything())
})

test('a failed report request does not create an archived report', async () => {
  ;(getStatsCalendarMonth as jest.Mock).mockRejectedValue(Error('offline'))
  render(<HealthRecap active selection={{ kind: 'week', anchor: '2026-09-28' }} />)
  await screen.findByText(/本次更新未完成/)
  expect(storage.get('period-recaps-v1:reader-a')).toBeUndefined()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('a storage failure does not prevent reading or claim that the book was saved', async () => {
  ;(Taro.setStorageSync as jest.Mock).mockImplementation(() => { throw Error('storage full') })
  render(<HealthRecap active selection={{ kind: 'week', anchor: '2026-09-28' }} />)
  await screen.findByRole('button', { name: '点击轻轻拆开我的周报' })
  expect(Taro.showToast).toHaveBeenCalledWith({ title: '报告已打开，书架暂未保存', icon: 'none' })
  expect(storage.get('period-recaps-v1:reader-a')).toBeUndefined()
})
