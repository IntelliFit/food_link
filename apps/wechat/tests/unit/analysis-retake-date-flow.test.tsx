import { act, fireEvent, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { ResultPage } from '../../src/packageExtra/pages/result'
import PrecisionConfirmPage from '../../src/packageExtra/pages/precision-confirm'
import { getAnalyzeTask, getHealthProfile } from '../../src/utils/api'
import { clearAnalyzeResultSessionCache } from '../../src/utils/analyze-result-session'
import { loadAnalysisRetryDate } from '../../src/utils/analysis-retry-date'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: unknown) => Component }))
jest.mock('../../src/utils/api', () => ({
  getAnalyzeTask: jest.fn(), getAccessToken: jest.fn(() => 'test-token'), getHealthProfile: jest.fn(),
  saveFoodRecord: jest.fn(), getFoodRecordById: jest.fn(), updateHealthProfile: jest.fn(),
  createUserRecipe: jest.fn(), updateAnalysisTaskResult: jest.fn(), createPackagedFood: jest.fn(),
  submitAnalyzeTask: jest.fn(), submitTextAnalyzeTask: jest.fn(), continuePrecisionSession: jest.fn(),
  submitAnalysisFeedback: jest.fn(), showUnifiedApiError: jest.fn(), ANALYSIS_FEEDBACK_SUBMISSION_ENABLED: false,
}))
jest.mock('../../src/pages/index/components/MealRecordPosterModal', () => ({ MealRecordPosterModal: () => null }))
jest.mock('../../src/components/MealImpactCard', () => ({
  useMealImpactSheet: () => ({ sheet: null, show: jest.fn() }), mealSummaryFromSavePayload: () => ({}),
}))
jest.mock('../../src/components/MealDishPrompt', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/AdaptiveImageGrid', () => ({ AdaptiveImageGrid: () => null }))
jest.mock('../../src/components/RecordDateField', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/packageExtra/pages/result/RecordDateChip', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/home-dashboard-local-cache', () => ({
  applyOptimisticFoodRecordToHomeDashboardSnapshot: jest.fn(), refreshHomeDashboardLocalSnapshotFromCloud: jest.fn(),
}))

let routeDate: string
let payload: Record<string, unknown>
let result: Record<string, unknown>
let loadPage: ((options: Record<string, string>) => void) | undefined
const storage = new Map<string, unknown>()
const drain = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() }

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 10, 10, 12))
  clearAnalyzeResultSessionCache()
  routeDate = '2026-11-08'
  payload = { recorded_on: '2026-11-08', meal_type: 'lunch' }
  result = {
    description: '本餐', insight: '测试营养分析', precisionSessionId: 'session/1', precisionStatus: 'needs_retake',
    retakeRequirements: [{ role: 'top_down', reason: '俯拍不清楚' }],
    items: [{ name: '手撕猪肉干', estimatedWeightGrams: 45, originalWeightGrams: 45,
      nutrients: { calories: 108, protein: 18.2, carbs: 1.2, fat: 3.2, fiber: 0, sugar: 0 } }],
  }
  loadPage = undefined
  storage.clear()
  storage.set('user_id', 'user-1')
  storage.set('recordTargetDate', '2026-11-09')
  storage.set('analysisHealthProfilePromptShown', true)
  ;(globalThis as unknown as { __ENABLE_DEV_DEBUG_UI__: boolean }).__ENABLE_DEV_DEBUG_UI__ = false
  ;(Taro as unknown as { getCurrentInstance: jest.Mock }).getCurrentInstance = jest.fn(() => ({ router: { params: { task_id: 'task-B', date: routeDate } } }))
  ;(Taro as unknown as { setNavigationBarColor: jest.Mock }).setNavigationBarColor = jest.fn().mockResolvedValue(undefined)
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key) ?? '')
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => storage.delete(key))
  ;(Taro.useLoad as jest.Mock).mockImplementation(callback => { loadPage = callback })
  ;(Taro.useDidShow as jest.Mock).mockImplementation(() => undefined)
  ;(Taro.useDidHide as jest.Mock).mockImplementation(() => undefined)
  ;(Taro.navigateTo as jest.Mock).mockResolvedValue({})
  ;(Taro.redirectTo as jest.Mock).mockResolvedValue({})
  ;(getHealthProfile as jest.Mock).mockResolvedValue({})
  ;(getAnalyzeTask as jest.Mock).mockImplementation(async () => ({
    id: 'task-B', user_id: 'user-1', task_type: 'food', status: 'done', payload, result,
    image_paths: ['https://example.test/top.jpg', 'https://example.test/oblique.jpg'], is_recorded: false,
  }))
})

afterEach(() => { jest.clearAllTimers(); jest.useRealTimers() })

async function renderResult() {
  const view = render(<ResultPage />)
  await act(drain)
  return view
}

async function renderPrecision() {
  const view = render(<PrecisionConfirmPage />)
  await act(async () => { loadPage?.({ task_id: 'task-B' }); await drain() })
  return view
}

describe('existing analysis retry date', () => {
  it('keeps the selected historical date when retaking from a result', async () => {
    const view = await renderResult()
    await act(async () => { fireEvent.click(view.getByText('重新拍照继续')); await drain() })
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?precision_session_id=session%2F1&date=2026-11-08&backfill=1' })
  })

  it('resolves a legacy result URL date from this task instead of the previous global date', async () => {
    routeDate = ''
    const view = await renderResult()
    await act(async () => { fireEvent.click(view.getByText('重新拍照继续')); await drain() })
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?precision_session_id=session%2F1&date=2026-11-08&backfill=1' })
  })

  it('preserves the explicit date when retrying an invalid photo result', async () => {
    result = { description: '没有有效食物', insight: '', items: [] }
    const view = await renderResult()
    await act(async () => { fireEvent.click(view.getByText('重新分析')); await drain() })
    expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?date=2026-11-08&backfill=1' })
  })

  it('blocks an expired result date instead of silently starting a record for today', async () => {
    routeDate = '2020-01-01'
    const view = await renderResult()
    await act(async () => { fireEvent.click(view.getByText('重新拍照继续')); await drain() })
    expect(Taro.navigateTo).not.toHaveBeenCalled()
    expect(Taro.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '请重新选择日期，仅支持近14天记录' }))
  })

  it('keeps the task date and untouched photo slot when retaking from precision confirmation', async () => {
    const view = await renderPrecision()
    await act(async () => { fireEvent.click(view.getByText('按要求重拍')); await drain() })
    expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?precision_session_id=session%2F1&date=2026-11-08&backfill=1' })
    expect(storage.get('analyzePrecisionRetakeImagePaths')).toEqual(['', 'https://example.test/oblique.jpg'])
  })

  it('keeps the video capture protocol and original date on a video retake', async () => {
    payload.capture_protocol = 'video_keyframes_v1'
    const view = await renderPrecision()
    await act(async () => { fireEvent.click(view.getByText('按要求重录')); await drain() })
    expect(Taro.redirectTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/analyze/index?precision_session_id=session%2F1&capture_mode=video&date=2026-11-08&backfill=1' })
  })

  it('does not clear retake photos or redirect an expired precision task to today', async () => {
    payload.recorded_on = '2020-01-01'
    storage.set('analyzePrecisionRetakeImagePaths', ['keep-this-photo'])
    const view = await renderPrecision()
    await act(async () => { fireEvent.click(view.getByText('按要求重拍')); await drain() })
    expect(Taro.redirectTo).not.toHaveBeenCalled()
    expect(storage.get('analyzePrecisionRetakeImagePaths')).toEqual(['keep-this-photo'])
  })

  it('defaults only a truly undated task to today and rejects a mismatched task response', async () => {
    payload = {}
    await expect(loadAnalysisRetryDate('', 'task-B')).resolves.toBe('2026-11-10')
    await expect(loadAnalysisRetryDate('', 'other-task')).rejects.toThrow('识别任务不匹配')
  })
})
