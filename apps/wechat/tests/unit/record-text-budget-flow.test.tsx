import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import RecordTextPage from '../../src/packageExtra/pages/record-text'
import { getHomeDashboard, getMyMembership, submitTextAnalyzeTask } from '../../src/utils/api'
import { advanceAuthSession } from '../../src/utils/auth-session'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, className, onClick }: any) => React.createElement('div', { className, onClick }, children),
    Text: ({ children, className, onClick }: any) => React.createElement('span', { className, onClick }, children),
    ScrollView: ({ children }: any) => React.createElement('div', {}, children),
    Picker: ({ children }: any) => React.createElement('div', {}, children),
    Textarea: ({ value, className, onInput }: any) => React.createElement('textarea', {
      value, className, onChange: (e: any) => onInput({ detail: { value: e.target.value } }),
    }),
  }
})
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: unknown) => Component }))
jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(() => 'test-token'),
  getHealthProfile: jest.fn().mockResolvedValue({}),
  getMyMembership: jest.fn(),
  getHomeDashboard: jest.fn(),
  submitTextAnalyzeTask: jest.fn(),
}))
jest.mock('../../src/utils/infer-default-meal-type', () => ({
  inferDefaultMealTypeFromLocalTime: () => 'lunch',
  getRecommendedMealTypeWithFallback: jest.fn().mockResolvedValue('lunch'),
}))
jest.mock('../../src/components/CreditShortageSheet', () => ({
  __esModule: true,
  default: ({ visible }: any) => visible ? <div data-testid='credit-shortage' /> : null,
}))
jest.mock('../../src/components/EatingMoodPicker', () => ({ __esModule: true, default: () => null }))

const credit = (system: number, earned = 0) => ({
  is_pro: false, daily_credits_max: 20, daily_credits_used: 20 - system,
  system_credits_remaining: system, earned_credits_balance: earned, total_credits_available: system + earned,
})
const storage = new Map<string, unknown>()
let route: Record<string, string>
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
const mount = async () => {
  const view = render(<RecordTextPage />)
  await act(flush)
  fireEvent.change(view.container.querySelector('.food-textarea')!, { target: { value: '一碗米饭' } })
  return view
}
const submit = async (view: ReturnType<typeof render>) => {
  await act(async () => { fireEvent.click(view.container.querySelector('.submit-btn')!); await flush() })
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 10, 10, 10))
  jest.clearAllMocks()
  route = { date: '2026-11-09' }
  storage.clear()
  storage.set('access_token', 'test-token')
  storage.set('user_id', 'user-a')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => storage.delete(key))
  ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
  ;(Taro.useDidHide as jest.Mock).mockImplementation(() => {})
  ;(Taro as any).getCurrentInstance = jest.fn(() => ({ router: { params: route } }))
  ;(getMyMembership as jest.Mock).mockImplementation(async (date?: string) => credit(date ? 20 : 0))
  ;(getHomeDashboard as jest.Mock).mockResolvedValue({
    intakeData: { target: 2000, current: 1900 }, nutritionTarget: { diet_goal: 'fat_loss' },
  })
  ;(submitTextAnalyzeTask as jest.Mock).mockResolvedValue({ task_id: 'text-task' })
  ;(Taro.navigateTo as jest.Mock).mockResolvedValue({})
})
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers() })

it('submits historical text using that day budget even if today has no credits', async () => {
  const view = await mount()
  await submit(view)
  expect(getHomeDashboard).toHaveBeenCalledWith('2026-11-09')
  expect(submitTextAnalyzeTask).toHaveBeenCalledWith(expect.objectContaining({
    text: '一碗米饭', date: '2026-11-09', remaining_calories: 100,
    diet_goal: 'fat_loss', user_goal: 'fat_loss', suggest_ratio_enabled: true,
  }))
  expect(Taro.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('task_id=text-task') }))
  expect(screen.queryByTestId('credit-shortage')).toBeNull()
})

it('keeps its visible date when another page changes shared storage before submission', async () => {
  const view = await mount()
  storage.set('recordTargetDate', '2026-11-10')
  await submit(view)
  expect(submitTextAnalyzeTask).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-09' }))
  expect(view.container).toHaveTextContent('正在补录 · 11月9日')
})

it.each(['2020-01-01', '2026-11-11'])('rejects unavailable date %s without silently submitting today', async date => {
  route = { date }
  const view = await mount()
  await submit(view)
  expect(submitTextAnalyzeTask).not.toHaveBeenCalled()
  expect(Taro.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('近14天') }))
})

it('preserves an explicitly chosen diet goal while still passing the real calorie budget', async () => {
  const view = await mount()
  fireEvent.click(screen.getByText('更多选项'))
  fireEvent.click(screen.getByText('增肌期'))
  await submit(view)
  expect(submitTextAnalyzeTask).toHaveBeenCalledWith(expect.objectContaining({
    remaining_calories: 100, diet_goal: 'muscle_gain', user_goal: 'muscle_gain',
  }))
})

it('does not fetch budget or invent remaining calories when suggestions are disabled', async () => {
  storage.set('analyzeSuggestRatioEnabled', false)
  const view = await mount()
  await submit(view)
  expect(getHomeDashboard).not.toHaveBeenCalled()
  const payload = (submitTextAnalyzeTask as jest.Mock).mock.calls[0][0]
  expect(payload.suggest_ratio_enabled).toBe(false)
  expect(payload.remaining_calories).toBeUndefined()
})

it('allows text analysis without a fabricated zero budget if dashboard lookup fails', async () => {
  ;(getHomeDashboard as jest.Mock).mockRejectedValue(new Error('unavailable'))
  const view = await mount()
  await submit(view)
  expect(submitTextAnalyzeTask).toHaveBeenCalledTimes(1)
  expect((submitTextAnalyzeTask as jest.Mock).mock.calls[0][0].remaining_calories).toBeUndefined()
})

it('cancels an old-account draft after a slow budget response, including A to B to A', async () => {
  let finish!: (result: unknown) => void
  ;(getHomeDashboard as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const view = await mount()
  await submit(view)
  advanceAuthSession()
  storage.set('user_id', 'user-b')
  advanceAuthSession()
  storage.set('user_id', 'user-a')
  await act(async () => { finish({ intakeData: { target: 2000, current: 1800 } }); await flush() })
  expect(submitTextAnalyzeTask).not.toHaveBeenCalled()
  expect(Taro.navigateTo).not.toHaveBeenCalled()
  expect(storage.get('analyzeTextInput')).toBeUndefined()
})

it('does not submit or navigate after the text page is hidden while waiting for budget', async () => {
  let hide!: () => void
  ;(Taro.useDidHide as jest.Mock).mockImplementation(callback => { hide = callback })
  let finish!: (result: unknown) => void
  ;(getHomeDashboard as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const view = await mount()
  await submit(view)
  hide()
  ;(Taro.hideLoading as jest.Mock).mockClear()
  await act(async () => { finish({ intakeData: { target: 2000, current: 1800 } }); await flush() })
  expect(submitTextAnalyzeTask).not.toHaveBeenCalled()
  expect(Taro.navigateTo).not.toHaveBeenCalled()
  expect(Taro.hideLoading).not.toHaveBeenCalled()
})

it('keeps an insufficient same-day request blocked', async () => {
  route = { date: '2026-11-10' }
  const view = await mount()
  await submit(view)
  expect(submitTextAnalyzeTask).not.toHaveBeenCalled()
  expect(screen.getByTestId('credit-shortage')).toBeInTheDocument()
})

it('allows the API to decide if the target day credit details are unavailable', async () => {
  ;(getMyMembership as jest.Mock).mockImplementation(async (date?: string) => date ? {} : credit(0))
  const view = await mount()
  await submit(view)
  expect(submitTextAnalyzeTask).toHaveBeenCalledTimes(1)
})

it('does not apply a retained old-account zero-credit snapshot to a new account', async () => {
  route = { date: '2026-11-10' }
  const view = await mount()
  expect(view.container.querySelector('.submit-btn')).toHaveTextContent('积分不足')
  advanceAuthSession()
  storage.set('user_id', 'user-b')
  await submit(view)
  expect(submitTextAnalyzeTask).toHaveBeenCalledTimes(1)
})
