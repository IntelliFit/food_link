/** @jest-environment node */

jest.mock('../../src/utils/api', () => ({
  getMealImpact: jest.fn(),
  getPetDailyBrief: jest.fn(),
}))

import { getMealImpact, getPetDailyBrief } from '../../src/utils/api'
import { firstMealLines, loadFirstMealLines, withDeadline } from '../../src/packageOnboarding/first-meal'

const impactMock = getMealImpact as jest.Mock
const dailyMock = getPetDailyBrief as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('firstMealLines', () => {
  it('reads the meal headline and an open task', () => {
    expect(firstMealLines(
      { headline: ' 这一餐让纤维 +6g，今天还差 8g ' },
      { task: { title: '再补 1 份蔬菜', reason: '今天蔬菜还差 2 份', done: false } },
    )).toEqual({ seen: '这一餐让纤维 +6g，今天还差 8g', task: '再补 1 份蔬菜', taskReason: '今天蔬菜还差 2 份' })
  })

  it('stays quiet when the APIs are missing or odd', () => {
    const empty = { seen: '', task: '', taskReason: '' }
    expect(firstMealLines(null, null)).toEqual(empty)
    expect(firstMealLines('404 page not found', '404 page not found')).toEqual(empty)
    expect(firstMealLines({ headline: 3 }, { task: null })).toEqual(empty)
  })

  it('does not hand out a task that is already done', () => {
    expect(firstMealLines({ headline: '' }, { task: { title: '再记一餐', done: true } }).task).toBe('')
  })
})

describe('loadFirstMealLines', () => {
  it('reads the meal impact and today task together', async () => {
    impactMock.mockResolvedValue({ headline: '这一餐让蛋白质 +22g，今天还差 30g' })
    dailyMock.mockResolvedValue({ task: { title: '再补 1 份蔬菜', reason: '蔬菜还差 2 份', done: false } })
    await expect(loadFirstMealLines('r1')).resolves.toEqual({
      seen: '这一餐让蛋白质 +22g，今天还差 30g',
      task: '再补 1 份蔬菜',
      taskReason: '蔬菜还差 2 份',
    })
    expect(impactMock).toHaveBeenCalledWith('r1', 3000)
  })

  it('skips the meal impact without a record and keeps the task', async () => {
    dailyMock.mockResolvedValue({ task: { title: '再记一餐', done: false } })
    await expect(loadFirstMealLines('')).resolves.toEqual({ seen: '', task: '再记一餐', taskReason: '' })
    expect(impactMock).not.toHaveBeenCalled()
  })

  it('returns empty lines when both calls fail', async () => {
    impactMock.mockRejectedValue(new Error('404'))
    dailyMock.mockRejectedValue(new Error('500'))
    await expect(loadFirstMealLines('r1')).resolves.toEqual({ seen: '', task: '', taskReason: '' })
  })
})

describe('withDeadline', () => {
  it('rejects a call that takes too long', async () => {
    jest.useFakeTimers()
    const raced = withDeadline(new Promise<string>(() => undefined), 50)
    jest.advanceTimersByTime(60)
    await expect(raced).rejects.toThrow('timeout')
    jest.useRealTimers()
  })

  it('passes a quick result through', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })
})
