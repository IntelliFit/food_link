import { act, renderHook } from '@testing-library/react'
import { getAnalyzeTask } from '../../src/utils/api'
import { useRecordDate } from '../../src/hooks/useRecordDate'
import { getTaskRecordTargetDate } from '../../src/utils/record-date'

jest.mock('../../src/utils/api', () => ({ getAnalyzeTask: jest.fn() }))

describe('record date belongs to the opened task', () => {
  beforeEach(() => jest.clearAllMocks())

  it('keeps an expired task date instead of replacing it with today', async () => {
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue({ payload: { recorded_on: '2020-01-01' } })
    const { result } = renderHook(() => useRecordDate('', 'old-task'))
    await act(async () => { await Promise.resolve() })
    expect(result.current[0]).toBe('2020-01-01')
    expect(getTaskRecordTargetDate({ payload: { date: '', recordedOn: '2020-01-02' } })).toBe('2020-01-02')
    expect(getTaskRecordTargetDate({ payload: {} })).toBe('')
  })

  it('does not overwrite an explicit selection when task lookup finishes later', async () => {
    let finish!: (task: unknown) => void
    ;(getAnalyzeTask as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { result } = renderHook(() => useRecordDate('', 'task'))
    act(() => result.current[1]('2026-10-03'))
    await act(async () => { finish({ payload: { date: '2026-10-02' } }) })
    expect(result.current[0]).toBe('2026-10-03')
  })
})
