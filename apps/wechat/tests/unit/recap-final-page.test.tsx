jest.mock('../../src/components/RecapMusic', () => ({ RecapMusic: () => null }))
import { act, fireEvent, render, screen } from '@testing-library/react'
import { HealthRecap } from '../../src/components/HealthRecap'
import { getStatsCalendarMonth } from '../../src/utils/api'
import { recapPeriod } from '../../src/utils/health-recap'

jest.mock('../../src/utils/api', () => ({
  getAccessToken: () => 'test-account', getStatsCalendarMonth: jest.fn(),
  getBodyMetricsSummary: jest.fn().mockResolvedValue({ start_date: '2026-01-01', end_date: '2026-12-31', water_daily: [], weight_entries: [] }),
  getUserProfile: jest.fn().mockResolvedValue({ id: 'u', nickname: '读者' }),
  getStatsSummary: jest.fn().mockResolvedValue(null),
  communityGetFeed: jest.fn().mockResolvedValue({ list: [] }),
  communityGetPublicFeed: jest.fn().mockResolvedValue({ list: [] }),
}))
jest.mock('../../src/utils/withAuth', () => ({ redirectToLogin: jest.fn() }))
jest.mock('../../src/components/RecapJournalScene', () => ({
  RecapJournalScene: ({ chapter, active, next, onBound }: { chapter: number; active: boolean; next: () => void; onBound: () => void }) => <button data-testid={`chapter-${chapter}`} disabled={!active} onClick={() => chapter === 5 ? setTimeout(onBound, 6400) : next()}>场景{chapter}</button>,
}))
jest.mock('../../src/components/RecapShare', () => ({ RecapShare: () => <div data-testid='keepsake'>纪念长卷</div> }))

test('binding and sharing stay on one final page, complete once and do not expose an extra chapter', async () => {
  jest.useFakeTimers()
  const period = recapPeriod('week', 2026, new Date('2026-09-21T12:00:00'))
  ;(getStatsCalendarMonth as jest.Mock).mockResolvedValue({ days: period.dates.map(date => ({ date, calories: 0, has_record: false })) })
  const complete = jest.fn()
  const { unmount } = render(<HealthRecap active selection={{ kind: 'week', anchor: '2026-09-21' }} onComplete={complete} />)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  act(() => jest.advanceTimersByTime(950))
  for (const chapter of [0, 1, 2, 4, 5]) {
    fireEvent.click(screen.getByTestId(`chapter-${chapter}`))
    act(() => jest.advanceTimersByTime(950))
  }
  expect(screen.queryByTestId('chapter-6')).not.toBeInTheDocument()
  expect(screen.queryByTestId('keepsake')).not.toBeInTheDocument()
  expect(complete).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(5450))
  expect(screen.getByTestId('chapter-5').closest('.health-recap__scene')).toContainElement(screen.getByTestId('keepsake'))
  expect(complete).toHaveBeenCalledTimes(1)
  act(() => jest.advanceTimersByTime(5000))
  expect(complete).toHaveBeenCalledTimes(1)
  unmount()
  jest.useRealTimers()
})
