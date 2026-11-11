import Taro from '@tarojs/taro'
import { consumeRecordReturnDate, isCalendarRecordDate, rememberRecordReturnDate, supplementTakenAtForDate } from '../../src/utils/record-navigation'

const store = new Map<string, any>()
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 10, 10, 12))
  store.clear(); store.set('user_id', 'A')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => store.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => store.set(key, value))
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => store.delete(key))
})
afterEach(() => { jest.useRealTimers() })

it('returns to the explicitly saved day once, instead of today or a global stale date', () => {
  store.set('recordTargetDate', '2026-11-09')
  rememberRecordReturnDate('2026-11-08')
  expect(consumeRecordReturnDate()).toBe('2026-11-08')
  expect(consumeRecordReturnDate()).toBe('')
})
it('rejects a return date left by another account or an earlier app launch', () => {
  rememberRecordReturnDate('2026-11-08'); store.set('user_id', 'B')
  expect(consumeRecordReturnDate()).toBe('')
  store.set('record_return_date_v1', { owner: 'B', date: '2026-11-08', runtimeId: 'old-app' })
  expect(consumeRecordReturnDate()).toBe('')
})
it.each(['2026-11-11', '2026-02-30', 'garbage', ''])('does not silently replace invalid/future date %s with today', date => {
  rememberRecordReturnDate(date)
  expect(consumeRecordReturnDate()).toBe('')
  expect(() => supplementTakenAtForDate(date)).toThrow('记录日期')
})
it('does not narrow the existing water and weight calendar to the food window', () => {
  expect(isCalendarRecordDate('2025-10-01')).toBe(true)
})
it('records the supplement on the selected China day while preserving time of day', () => {
  const taken = supplementTakenAtForDate('2026-11-08', new Date('2026-11-10T04:35:20Z'))
  expect(taken).toBe('2026-11-08T12:35:20+08:00')
  expect(new Date(taken).toISOString()).toBe('2026-11-08T04:35:20.000Z')
})
