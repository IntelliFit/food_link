import { fireEvent, render, screen } from '@testing-library/react'
import { RecapInteraction } from '../../src/components/RecapInteraction'

const base = { kind: 'week' as const, days: [{ date: '2026-09-14', calories: 1200, has_record: true }], favorite: 1, collected: [], collect: jest.fn() }

test('quiz keeps answer hidden until a choice, and permits direct reveal', () => {
  render(<RecapInteraction {...base} chapter={2} />)
  expect(screen.queryByText(/代表日是/)).toBeNull()
  fireEvent.click(screen.getByText('直接揭晓 →'))
  expect(screen.getByText(/代表日是周一/)).toBeInTheDocument()
})

test('empty report has no invented favorite weekday quiz', () => {
  render(<RecapInteraction {...base} days={[]} chapter={2} />)
  expect(screen.queryByText('直接揭晓 →')).toBeNull()
  expect(screen.getByText(/故事还没开始/)).toBeInTheDocument()
})

test('selecting a blank day distinguishes missing records from zero intake', () => {
  render(<RecapInteraction {...base} days={[{ date: '2026-09-14', calories: 0, has_record: false }]} chapter={1} />)
  fireEvent.click(screen.getByText('09-14'))
  expect(screen.getByText(/这一格留白/)).toBeInTheDocument()
})
