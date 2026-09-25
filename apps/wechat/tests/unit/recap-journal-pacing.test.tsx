import { act, fireEvent, render, screen } from '@testing-library/react'
import { RecapJournalScene } from '../../src/components/RecapJournalScene'
import { journalBody } from '../../src/utils/recap-journal'
import { emptyJourney } from '../../src/utils/recap-story'
import type { BodyMetricsSummary } from '../../src/utils/api'

const days = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-09-${String(index + 7).padStart(2, '0')}`,
  calories: index % 2 ? 0 : 1000,
  has_record: index % 2 === 0,
}))

test('weekly bicycle journey visits every stop and does not turn the page too quickly', () => {
  jest.useFakeTimers()
  const next = jest.fn()
  const onJourney = jest.fn()
  render(<RecapJournalScene
    chapter={4}
    kind='year'
    days={days}
    recorded={4}
    next={next}
    journey={emptyJourney()}
    onJourney={onJourney}
    active
    body={journalBody(undefined, '2026-09-07', '2026-09-13')}
    health={null}
    photos={null}
    photosBusy={false}
    photosError={false}
    retryPhotos={jest.fn()}
  />)

  fireEvent.click(screen.getByRole('button', { name: '骑过这段旅程' }))
  act(() => { jest.advanceTimersByTime(7500) })
  expect(next).not.toHaveBeenCalled()
  expect(onJourney).toHaveBeenCalledTimes(12)
  expect(screen.getAllByText(/抵达/).length).toBeGreaterThan(0)
  act(() => { jest.advanceTimersByTime(400) })
  expect(next).toHaveBeenCalledTimes(1)
  jest.useRealTimers()
})

test('water recap lifts a held glass, reveals the equivalent cups, and waits for the reader', () => {
  jest.useFakeTimers()
  const next = jest.fn()
  const body = journalBody({
    range: 'week',
    start_date: '2026-09-07',
    end_date: '2026-09-13',
    water_goal_ml: 2000,
    today_water: { date: '2026-09-13', total: 0, logs: [] },
    water_daily: [{ date: '2026-09-10', total: 2000, logs: [2000] }],
    total_water_ml: 2000,
    avg_daily_water_ml: 2000,
    water_recorded_days: 1,
    weight_entries: [],
  } as BodyMetricsSummary, '2026-09-07', '2026-09-13')
  render(<RecapJournalScene
    chapter={2}
    kind='week'
    days={days}
    recorded={4}
    next={next}
    journey={emptyJourney()}
    onJourney={jest.fn()}
    active
    body={body}
    health={null}
    photos={null}
    photosBusy={false}
    photosError={false}
    retryPhotos={jest.fn()}
  />)

  expect(screen.getByLabelText('手拿水杯')).toBeInTheDocument()
  expect(screen.queryByText(/水位正在慢慢上升/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '举起水杯查看本期饮水量' }))
  act(() => { jest.advanceTimersByTime(1450) })
  expect(document.body.textContent).toContain('相当于 8 杯水')
  expect(screen.getByText('按每杯 250 mL 折算')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '看完饮水回顾并继续' })).toBeInTheDocument()

  act(() => { jest.advanceTimersByTime(8000) })
  expect(screen.getByRole('button', { name: '看完饮水回顾并继续' })).toBeInTheDocument()
  expect(screen.queryByText(/洒水壶|浇灌|水从不催促花开/)).not.toBeInTheDocument()
  expect(next).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '看完饮水回顾并继续' }))
  expect(next).toHaveBeenCalledTimes(1)
  jest.useRealTimers()
})
