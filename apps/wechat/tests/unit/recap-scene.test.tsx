import { act, fireEvent, render, screen } from '@testing-library/react'
import { RecapDeparture } from '../../src/components/RecapPlay'
import { emptyJourney } from '../../src/utils/recap-story'
import { RecapScene } from '../../src/components/RecapScene'

const props = { chapter: 1, kind: 'year' as const, recorded: 3, longest: 1, average: null, title: '生活观察员', next: jest.fn(), days: [
  { date: '2025-01-01', has_record: true, calories: 1000 },
  { date: '2025-03-01', has_record: true, calories: 1000 },
  { date: '2025-03-02', has_record: false, calories: 0 },
  { date: '2025-12-01', has_record: true, calories: 1000 },
] }

test('season interaction includes both ends of the calendar year and excludes missing records', () => {
  render(<RecapScene {...props} />)
  fireEvent.click(screen.getByText('冬'))
  expect(screen.getByText(/冬季 · 2 天记录/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('春'))
  expect(screen.getByText(/春季 · 1 天记录/)).toBeInTheDocument()
})

test('table reveals missing calorie data as unavailable, not a fabricated zero', () => {
  render(<RecapScene {...props} chapter={1} kind='week' />)
  fireEvent.click(screen.getByText('直接揭晓'))
  fireEvent.click(screen.getByText('热量记忆'))
  expect(screen.queryByText('日均热量等待记录')).toBeNull()
  fireEvent.click(screen.getByText('记录说明'))
  expect(screen.getByText('日均热量等待记录')).toBeInTheDocument()
})

test('opening the letter reveals it before advancing to the next scene', () => {
  const next = jest.fn()
  render(<RecapScene {...props} chapter={0} kind='week' recipient='小明' next={next} />)
  fireEvent.click(screen.getByRole('button', { name: '打开桌上的信封' }))
  expect(next).not.toHaveBeenCalled()
  expect(screen.getByText('尊敬的小明：')).toBeInTheDocument()
  expect(screen.queryByText('拆开这封信')).toBeNull()
  expect(screen.queryByText('你的生活来信')).toBeNull()
  expect(screen.queryByText('点信封，开启回忆')).toBeNull()
})


test('revealing a fact does not collect it until explicitly kept', () => {
  const onJourney = jest.fn()
  render(<RecapScene {...props} kind='week' journey={emptyJourney()} onJourney={onJourney} />)
  fireEvent.click(screen.getByText('直接揭晓'))
  fireEvent.click(screen.getByText('日子的味道'))
  expect(onJourney).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('收下'))
  expect(onJourney).toHaveBeenCalledWith({ discoveries: [0] })
})

test('departure cancels on early release and leaving the scene', () => {
  jest.useFakeTimers()
  const onSelect = jest.fn()
  const view = render(<RecapDeparture value='' active onSelect={onSelect} />)
  const launch = screen.getByRole('button', { name: '长按出发' })
  fireEvent.touchStart(launch)
  act(() => jest.advanceTimersByTime(400))
  fireEvent.touchEnd(launch)
  act(() => jest.advanceTimersByTime(1000))
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.touchStart(launch)
  view.rerender(<RecapDeparture value='' active={false} onSelect={onSelect} />)
  act(() => jest.advanceTimersByTime(1000))
  expect(onSelect).not.toHaveBeenCalled()
  view.rerender(<RecapDeparture value='' active onSelect={onSelect} />)
  fireEvent.touchStart(launch)
  act(() => jest.advanceTimersByTime(900))
  expect(onSelect).toHaveBeenCalledWith('散一会儿步')
  jest.useRealTimers()
})

 test('letter uses a neutral greeting when account nickname is unavailable', () => {
  render(<RecapScene {...props} chapter={0} kind='week' />)
  fireEvent.click(screen.getByRole('button', { name: '打开桌上的信封' }))
  expect(screen.getByText('尊敬的朋友：')).toBeInTheDocument()
  expect(screen.getByText(/愿你三餐有暖/)).toBeInTheDocument()
 })
