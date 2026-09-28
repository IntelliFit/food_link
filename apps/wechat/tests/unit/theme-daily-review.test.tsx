import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { ThemeDailyReview, reviewSummary } from '../../src/components/ThemeDailyReview'
import { waterFlowDays } from '../../src/components/WaterDailyFlow'
import { BALANCED_THEME_IDS } from '../../src/utils/balanced-theme'

jest.mock('../../src/utils/balanced-theme-scenes', () => ({ BALANCED_SCENES: {}, loadBalancedScenes: jest.fn().mockResolvedValue(undefined) }))

const entries = [{ date: '2026-09-22', calories: 1000 }, { date: '2026-09-24', calories: 2000 }]
const canvasContext = { scale: jest.fn(), beginPath: jest.fn(), arc: jest.fn(), stroke: jest.fn(), fill: jest.fn(), fillText: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), bezierCurveTo: jest.fn(), fillRect: jest.fn() }
beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  Object.assign(Taro, { createSelectorQuery: jest.fn(() => ({ select: () => ({ fields: () => ({ exec: (callback: (rows: unknown[]) => void) => callback([{ node: { getContext: () => canvasContext }, width: 360, height: 250 }]) }) }) })) })
})
afterEach(() => { jest.useRealTimers() })

it('averages only known days and leaves an unrecorded week unknown', () => {
  expect(reviewSummary(waterFlowDays('2026-09-28', entries))).toEqual({ count: 2, average: 1500 })
  expect(reviewSummary(waterFlowDays('2026-09-28'))).toEqual({ count: 0, average: null })
})

it.each(BALANCED_THEME_IDS)('%s keeps date selection, record action, and guest privacy', async theme => {
  const record = jest.fn()
  const props = { theme, endDate: '2026-09-28', days: entries, water: [{ date: '2026-09-22', total: 650 }], onRecord: record }
  const { container, rerender } = render(<ThemeDailyReview {...props} />)
  await act(async () => { await Promise.resolve(); jest.advanceTimersByTime(200) })
  fireEvent.click(container.querySelector(theme === 'way-of-water' ? '#water-day-0' : '#theme-review-day-0')!)
  expect(screen.getByText('650 ml')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: theme === 'way-of-water' ? /回首页记录/ : '去记录今天' }))
  expect(record).toHaveBeenCalledTimes(1)
  rerender(<ThemeDailyReview {...props} guest />)
  expect(screen.queryByText('650 ml')).not.toBeInTheDocument()
  expect(container.textContent).not.toContain('1500')
  rerender(<ThemeDailyReview {...props} endDate='2026-08-28' days={[]} water={[]} />)
  expect(screen.getByText('08 / 28')).toBeInTheDocument()
})

it('does not draw a river connecting across a missing day', async () => {
  render(<ThemeDailyReview theme='eastern-salon' endDate='2026-09-28' days={entries} onRecord={jest.fn()} />)
  await act(async () => { jest.advanceTimersByTime(200) })
  expect(canvasContext.bezierCurveTo).not.toHaveBeenCalled()
  expect(canvasContext.arc).toHaveBeenCalledTimes(2)
})

it('keeps a tiny nonzero gallery segment smaller than a full circle', async () => {
  render(<ThemeDailyReview theme='modern-gallery' endDate='2026-09-28' days={[{ date: '2026-09-22', calories: 1 }, { date: '2026-09-24', calories: 2000 }]} onRecord={jest.fn()} />)
  await act(async () => { jest.advanceTimersByTime(200) })
  const [, , , start, end] = canvasContext.arc.mock.calls[0]
  expect(end).toBeGreaterThan(start)
  expect(end - start).toBeLessThan(.01)
})
