import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro, { useDidHide, useDidShow, useRouter } from '@tarojs/taro'
import RecapPage from '../../src/packageRecap/pages/recap/index'
import { getAccessToken, getStatsCalendarMonth } from '../../src/utils/api'
import { recapArchiveEntry } from '../../src/utils/recap-archive'
import { localDay } from '../../src/utils/health-recap'

jest.mock('../../src/utils/api', () => ({ getAccessToken: jest.fn(), getStatsCalendarMonth: jest.fn() }))
jest.mock('../../src/components/HealthRecap', () => ({ HealthRecap: ({ selection, onShelf }: { selection: { id: string }; onShelf: () => void }) => <><span data-testid='open-report'>{selection.id}</span><button onClick={onShelf}>回到书架</button></> }))
let account: string, token: string, storage: Map<string, unknown>, show: () => void
function calendar(month: string, recorded = ['2026-09-22']) {
  const date = new Date(`${month}-01T12:00:00`), days: { date: string; calories: number; has_record: boolean }[] = []
  while (localDay(date).startsWith(month)) { const day = localDay(date); days.push({ date: day, calories: 0, has_record: recorded.includes(day) }); date.setDate(date.getDate() + 1) }
  return { month, days }
}
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-08T12:00:00'))
  account = 'shelf-a'; token = 'token-a'; storage = new Map(); show = () => undefined
  ;(useRouter as jest.Mock).mockReturnValue({ params: {} })
  ;(useDidShow as jest.Mock).mockImplementation(callback => { show = callback })
  ;(useDidHide as jest.Mock).mockImplementation(() => undefined)
  ;(getAccessToken as jest.Mock).mockImplementation(() => token)
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === 'user_id' ? account : storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async month => calendar(month))
})
afterEach(() => jest.useRealTimers())
async function mount() { const result = render(<RecapPage />); await act(async () => { show() }); return result }

test('all saved weekly, monthly and yearly books remain visible in development preview', async () => {
  const entries = [recapArchiveEntry('week', '2026-09-28'), recapArchiveEntry('week', '2026-09-21'), recapArchiveEntry('month', '2026-10-01'), recapArchiveEntry('year', '2026-01-01')]
  storage.set('period-recaps-v1:shelf-a', entries)
  await mount()
  expect(screen.getAllByRole('button', { name: /^取出/ })).toHaveLength(4)
  expect(screen.getByText('已收藏 4 本生活手记')).toBeInTheDocument()
  expect(storage.get('period-recaps-v1:shelf-a')).toHaveLength(4)
})

test('an empty shelf recovers a real historical week and the book opens the original report', async () => {
  await mount()
  expect(screen.queryByText('书架，为你的生活留着位置')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '取出2026年 第39周' }))
  await act(async () => { jest.advanceTimersByTime(850) })
  expect(screen.getByTestId('open-report')).toHaveTextContent('week:2026-09-21')
  expect(storage.get('period-recaps-v1:shelf-a')).toEqual([expect.objectContaining({ kind: 'week', start: '2026-09-21', end: '2026-09-27' })])
  fireEvent.click(screen.getByText('回到书架'))
  await act(async () => { jest.advanceTimersByTime(600) })
  expect(screen.getByRole('button', { name: '取出2026年 第39周' })).toBeInTheDocument()
})

test('network failures keep saved books and offer a working retry without clearing the archive', async () => {
  const existing = [recapArchiveEntry('week', '2026-09-21')]
  storage.set('period-recaps-v1:shelf-a', existing)
  ;(getStatsCalendarMonth as jest.Mock).mockRejectedValue(Error('offline'))
  await mount()
  expect(screen.getAllByRole('button', { name: /^取出/ })).toHaveLength(1)
  expect(screen.getByText(/部分往期周报暂未取回/)).toBeInTheDocument()
  expect(storage.get('period-recaps-v1:shelf-a')).toEqual(existing)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async month => calendar(month))
  await act(async () => { fireEvent.click(screen.getByText('重新取回')) })
  expect(screen.getAllByRole('button', { name: /^取出/ })).toHaveLength(2)
  expect(screen.queryByText(/部分往期周报暂未取回/)).toBeNull()
})

test('a late account A response cannot add books to account B or keep account A books visible', async () => {
  const old = [recapArchiveEntry('week', '2026-09-21')]
  storage.set('period-recaps-v1:shelf-a', old)
  const pending: { month: string; resolve: (value: unknown) => void }[] = []
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(month => new Promise(resolve => pending.push({ month, resolve })))
  await mount()
  account = 'shelf-b'; token = 'token-b'
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async month => calendar(month, ['2026-10-02']))
  await act(async () => { show() })
  await act(async () => { pending.forEach(entry => entry.resolve(calendar(entry.month))) })
  expect(screen.getAllByRole('button', { name: /^取出/ })).toHaveLength(1)
  expect(screen.getByRole('button', { name: '取出2026年 第40周' })).toBeInTheDocument()
  expect(storage.get('period-recaps-v1:shelf-a')).toEqual(old)
  expect(storage.get('period-recaps-v1:shelf-b')).toEqual([expect.objectContaining({ start: '2026-09-28' })])
})
