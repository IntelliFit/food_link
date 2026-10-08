import Taro from '@tarojs/taro'
import { getAccessToken, getStatsCalendarMonth } from '../../src/utils/api'
import { archiveRecaps, mergeRecapEntries, normalizeRecapEntry, readRecapArchive, recapArchiveEntry, recoverWeeklyRecaps } from '../../src/utils/recap-archive'
import { localDay } from '../../src/utils/health-recap'

jest.mock('../../src/utils/api', () => ({ getAccessToken: jest.fn(), getStatsCalendarMonth: jest.fn() }))
let storage: Map<string, unknown>, account: string, token: string
function calendar(month: string, dates = ['2026-09-22']) {
  const date = new Date(`${month}-01T12:00:00`), days: { date: string; calories: number; has_record: boolean }[] = []
  while (localDay(date).startsWith(month)) { const day = localDay(date); days.push({ date: day, calories: 0, has_record: dates.includes(day) }); date.setDate(date.getDate() + 1) }
  return { month, days }
}
beforeEach(() => {
  jest.clearAllMocks(); storage = new Map(); account = 'reader-a'; token = 'token-a'
  ;(getAccessToken as jest.Mock).mockImplementation(() => token)
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === 'user_id' ? account : storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async month => calendar(month))
})

test('keeps all existing books and their original bookmark IDs while deduplicating periods', () => {
  const old = { ...recapArchiveEntry('week', '2026-09-28'), id: 'old-book-id' }
  const annual = recapArchiveEntry('year', '2026-01-05')
  expect(mergeRecapEntries([old, annual], [recapArchiveEntry('week', '2026-09-28')])).toEqual([old, annual])
  const many = Array.from({ length: 65 }, (_, index) => { const date = new Date('2026-10-08T12:00:00'); date.setDate(date.getDate() - index * 7); return recapArchiveEntry('week', localDay(date)) })
  storage.set('period-recaps-v1:reader-a', many)
  expect(readRecapArchive(account)).toHaveLength(65)
})

test('repairs missing legacy period dates but rejects impossible or mismatched dates', () => {
  expect(normalizeRecapEntry({ kind: 'week', anchor: '2026-09-28', id: 'old' })?.start).toBe('2026-09-21')
  expect(normalizeRecapEntry({ kind: 'week', anchor: '2026-13-01', id: 'bad' })).toBeNull()
  expect(normalizeRecapEntry({ kind: 'week', anchor: '2026-02-30', id: 'bad' })).toBeNull()
  expect(normalizeRecapEntry({ ...recapArchiveEntry('week', '2026-09-28'), end: '2026-10-08' })).toBeNull()
})

test('backfills a real completed week without creating books for empty weeks or current-week records', async () => {
  const recovered = await recoverWeeklyRecaps(new Date('2026-10-08T12:00:00'))
  expect(recovered.incomplete).toBe(false)
  expect(recovered.entries.map(entry => entry.id)).toEqual(['week:2026-09-21'])
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async month => calendar(month, ['2026-10-07']))
  expect((await recoverWeeklyRecaps(new Date('2026-10-08T12:00:00'))).entries).toEqual([])
})

test('a cross-month week requires complete calendars and failures do not fabricate missing days', async () => {
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async month => { if (month === '2026-10') throw Error('offline'); return calendar(month, ['2026-09-29']) })
  const recovered = await recoverWeeklyRecaps(new Date('2026-10-08T12:00:00'))
  expect(recovered.incomplete).toBe(true)
  expect(recovered.entries).toEqual([])
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('archives merge with fresh local metadata and never overwrite a failed read or a different account', () => {
  storage.set('period-recaps-v1:reader-a', [recapArchiveEntry('week', '2026-09-21')])
  expect(archiveRecaps(account, [recapArchiveEntry('week', '2026-09-28')])).toHaveLength(2)
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => { if (key === 'user_id') return account; throw Error('storage unavailable') })
  expect(() => archiveRecaps(account, [recapArchiveEntry('week', '2026-10-05')])).toThrow('storage unavailable')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  account = 'reader-b'
  expect(() => archiveRecaps('reader-a', [recapArchiveEntry('week', '2026-10-05')])).toThrow('account changed')
  token = 'token-b'
  expect(() => archiveRecaps('reader-b', [], 'token-a')).toThrow('account changed')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('cancelling recovery during an account switch discards the old result and stops later requests', async () => {
  let active = true
  ;(getStatsCalendarMonth as jest.Mock).mockImplementation(async month => { active = false; return calendar(month) })
  expect((await recoverWeeklyRecaps(new Date('2026-10-08T12:00:00'), 0, () => active)).entries).toEqual([])
  expect(getStatsCalendarMonth).toHaveBeenCalledTimes(2)
})
