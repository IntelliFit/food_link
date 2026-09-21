import { act, fireEvent, render, screen } from '@testing-library/react'
import { RecapJournalScene } from '../../src/components/RecapJournalScene'
import { journalBody } from '../../src/utils/recap-journal'
import { emptyJourney } from '../../src/utils/recap-story'

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
    kind='week'
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
  act(() => { jest.advanceTimersByTime(6500) })
  expect(next).not.toHaveBeenCalled()
  expect(onJourney).toHaveBeenCalledTimes(7)
  expect(screen.getAllByText(/抵达/).length).toBeGreaterThan(0)
  act(() => { jest.advanceTimersByTime(400) })
  expect(next).toHaveBeenCalledTimes(1)
  jest.useRealTimers()
})
