import { act, fireEvent, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { AnalyzePage } from '../../src/packageExtra/pages/analyze'
import { getHomeDashboard, getMyMembership, submitAnalyzeTask, uploadAnalyzeImageFile } from '../../src/utils/api'
import { openFoodCameraForResult, takeFoodCameraResult } from '../../src/utils/food-camera'
import { advanceAuthSession } from '../../src/utils/auth-session'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, className, onClick, style }: any) => React.createElement('div', { className, onClick, style }, children),
    Text: ({ children, className, onClick }: any) => React.createElement('span', { className, onClick }, children),
    Picker: ({ children }: any) => React.createElement('div', {}, children),
    Image: ({ src, className }: any) => React.createElement('img', { src, className }),
    Textarea: ({ value, className }: any) => React.createElement('textarea', { value, className, readOnly: true }),
    PageMeta: () => null,
    Video: () => null,
  }
})
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: unknown) => Component }))
jest.mock('../../src/utils/api', () => ({
  imageToBase64: jest.fn(),
  compressImagePathForUpload: jest.fn(async (path: string) => path),
  uploadAnalyzeImage: jest.fn(),
  uploadAnalyzeImageFile: jest.fn(),
  uploadAnalyzeVideoFile: jest.fn(),
  submitAnalyzeTask: jest.fn(),
  continuePrecisionSession: jest.fn(),
  getAccessToken: jest.fn(() => 'test-token'),
  getHealthProfile: jest.fn().mockResolvedValue({ execution_mode: 'standard', health_condition: {} }),
  updateHealthProfile: jest.fn(),
  getMyMembership: jest.fn().mockResolvedValue({ is_pro: false }),
  getHomeDashboard: jest.fn(),
  showUnifiedApiError: jest.fn(),
}))
jest.mock('../../src/utils/membership', () => jest.requireActual('../../src/utils/membership'))
jest.mock('../../src/utils/execution-mode', () => ({
  canUseStrictModeForMembership: () => false,
  getStrictModeLockedHint: () => '',
  getStrictModeUpgradeUrl: () => '',
  isPrecisionExecutionMode: () => false,
  normalizeAvailableExecutionMode: () => 'standard',
  promptStrictModeUpgrade: jest.fn(),
}))
jest.mock('../../src/utils/infer-default-meal-type', () => ({
  inferDefaultMealTypeFromLocalTime: () => 'lunch',
  getRecommendedMealTypeWithFallback: jest.fn().mockResolvedValue('lunch'),
}))
jest.mock('../../src/utils/food-camera', () => ({
  openFoodCameraForResult: jest.fn().mockResolvedValue(undefined),
  takeFoodCameraResult: jest.fn(() => []),
}))
jest.mock('../../src/utils/onboarding-guide-storage', () => ({
  ONBOARDING_ANALYZE_PREP_GUIDE_KEY: 'analyze-guide',
  shouldOfferOnboardingGuide: () => false,
}))
jest.mock('../../src/utils/page-scroll-lock', () => ({ PAGE_SCROLL_LOCK_STYLE: '', usePageScrollLock: () => {} }))
jest.mock('../../src/components/CreditShortageSheet', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/EatingMoodPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/OnboardingGuide', () => ({ __esModule: true, default: () => null }))

const savedPhoto = 'https://fixture.invalid/old-photo.jpg'
const freshLocalPhoto = 'wxfile://photo-taken-on-return.jpg'
const freshUploadedPhoto = 'https://fixture.invalid/photo-taken-on-return.jpg'

describe('AnalyzePage record date at submission', () => {
  let storage: Map<string, unknown>
  let route: Record<string, string>
  let didShows: Set<() => void>
  let didHides: Set<() => void>

  const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
  const show = async () => {
    await act(async () => {
      for (const callback of [...didShows]) callback()
      await flush()
    })
  }
  const mountPage = async () => {
    const view = render(<AnalyzePage />)
    await act(flush)
    await show()
    return view
  }
  const submit = async (view: ReturnType<typeof render>) => {
    await act(async () => {
      fireEvent.click(view.container.querySelector('.confirm-btn')!)
      await flush()
    })
  }
  const resumeOnNovember10 = async () => {
    await act(async () => { for (const callback of [...didHides]) callback() })
    jest.setSystemTime(new Date('2026-11-10T04:00:00Z'))
    await show()
  }

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-10T04:00:00Z'))
    jest.clearAllMocks()
    didShows = new Set()
    didHides = new Set()
    storage = new Map<string, unknown>([
      ['user_id', 'user-1'], ['recordTargetDate', '2026-11-08'], ['analyzeImagePaths', [savedPhoto]],
    ])
    route = { date: '2026-11-08' }
    ;(Taro as any).getCurrentInstance = jest.fn(() => ({ router: { params: route } }))
    ;(Taro as any).getEnv = jest.fn(() => 'TEST')
    ;(Taro as any).ENV_TYPE = { WEAPP: 'WEAPP' }
    ;(Taro as any).showActionSheet = jest.fn().mockResolvedValue({ tapIndex: 0 })
    ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => storage.get(key) ?? '')
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => storage.set(key, value))
    ;(Taro.removeStorageSync as jest.Mock).mockImplementation((key: string) => storage.delete(key))
    ;(Taro.useDidShow as jest.Mock).mockImplementation((callback: () => void) => {
      require('react').useEffect(() => {
        didShows.add(callback)
        return () => didShows.delete(callback)
      })
    })
    ;(Taro.useDidHide as jest.Mock).mockImplementation((callback: () => void) => {
      require('react').useEffect(() => {
        didHides.add(callback)
        return () => didHides.delete(callback)
      })
    })
    ;(getHomeDashboard as jest.Mock).mockResolvedValue({ intakeData: { target: 2000, current: 1000 }, nutritionTarget: { diet_goal: 'maintain' } })
    ;(submitAnalyzeTask as jest.Mock).mockResolvedValue({ task_id: 'new-task' })
    ;(uploadAnalyzeImageFile as jest.Mock).mockResolvedValue({ imageUrl: freshUploadedPhoto })
    ;(takeFoodCameraResult as jest.Mock).mockReturnValue([])
    ;(getMyMembership as jest.Mock).mockResolvedValue({ is_pro: false })
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('ignores a bare historical date and old global date when starting a new analysis today', async () => {
    const view = await mountPage()
    await submit(view)
    expect(submitAnalyzeTask).toHaveBeenCalledTimes(1)
    expect(submitAnalyzeTask).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-10', image_urls: [savedPhoto] }))
    expect(getHomeDashboard).toHaveBeenCalledWith('2026-11-10')
  })

  it('keeps a legal historical date only when the route explicitly requests backfill', async () => {
    route.backfill = '1'
    const view = await mountPage()
    await submit(view)
    expect(submitAnalyzeTask).toHaveBeenCalledTimes(1)
    expect(submitAnalyzeTask).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-08' }))
    expect(getHomeDashboard).toHaveBeenCalledWith('2026-11-08')
  })

  it('uses November 10 for a new camera photo after a November 8 page resumes', async () => {
    jest.setSystemTime(new Date('2026-11-08T04:00:00Z'))
    storage.set('analyzeImagePaths', [])
    const view = await mountPage()
    await resumeOnNovember10()
    await act(async () => {
      fireEvent.click(view.container.querySelector('.no-image-placeholder')!)
      await flush()
    })
    expect(openFoodCameraForResult).toHaveBeenCalledWith(5)
    ;(takeFoodCameraResult as jest.Mock).mockReturnValueOnce([freshLocalPhoto])
    await show()
    expect(view.container.querySelector('.image-grid__image')).toHaveAttribute('src', freshLocalPhoto)
    await submit(view)
    expect(uploadAnalyzeImageFile).toHaveBeenCalledWith(freshLocalPhoto)
    expect(submitAnalyzeTask).toHaveBeenCalledTimes(1)
    expect(submitAnalyzeTask).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-10', image_urls: [freshUploadedPhoto] }))
    expect(getHomeDashboard).toHaveBeenCalledWith('2026-11-10')
  })

  it('preserves explicit November 8 backfill after the page resumes on November 10', async () => {
    jest.setSystemTime(new Date('2026-11-08T04:00:00Z'))
    route.backfill = '1'
    const view = await mountPage()
    await resumeOnNovember10()
    await submit(view)
    expect(submitAnalyzeTask).toHaveBeenCalledTimes(1)
    expect(submitAnalyzeTask).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-08', image_urls: [savedPhoto] }))
    expect(getHomeDashboard).toHaveBeenCalledWith('2026-11-08')
  })

  it.each([
    { backfill: false, expectedDate: '2026-11-10', remainingCalories: 1800 },
    { backfill: true, expectedDate: '2026-11-08', remainingCalories: 900 },
  ])('resolves date and budget after a camera upload crosses midnight (backfill=$backfill)', async ({ backfill, expectedDate, remainingCalories }) => {
    jest.setSystemTime(new Date(2026, 10, 9, 23, 59, 59))
    if (backfill) route.backfill = '1'
    storage.set('analyzeImagePaths', [freshLocalPhoto])
    let finishUpload!: (value: { imageUrl: string }) => void
    ;(uploadAnalyzeImageFile as jest.Mock).mockReturnValue(new Promise(resolve => { finishUpload = resolve }))
    ;(getHomeDashboard as jest.Mock).mockImplementation(async (date: string) => ({
      intakeData: { target: 2000, current: date === '2026-11-10' ? 200 : date === '2026-11-08' ? 1100 : 1500 },
      nutritionTarget: { diet_goal: 'maintain' },
    }))
    const view = await mountPage()
    await submit(view)
    expect(uploadAnalyzeImageFile).toHaveBeenCalledWith(freshLocalPhoto)
    expect(submitAnalyzeTask).not.toHaveBeenCalled()

    jest.setSystemTime(new Date(2026, 10, 10, 0, 0, 1))
    await act(async () => {
      finishUpload({ imageUrl: freshUploadedPhoto })
      await flush()
    })
    expect(submitAnalyzeTask).toHaveBeenCalledTimes(1)
    expect(submitAnalyzeTask).toHaveBeenCalledWith(expect.objectContaining({
      date: expectedDate, image_urls: [freshUploadedPhoto], remaining_calories: remainingCalories,
    }))
    expect(getHomeDashboard).toHaveBeenLastCalledWith(expectedDate)
  })

  it('submits explicit photo backfill using target credits when today is exhausted', async () => {
    route.backfill = '1'
    storage.set('access_token', 'test-token')
    ;(getMyMembership as jest.Mock).mockImplementation(async (date?: string) => ({
      is_pro: false, daily_credits_max: 20, system_credits_remaining: date ? 20 : 0,
      earned_credits_balance: 0, total_credits_available: date ? 20 : 0,
    }))
    const view = await mountPage()
    await submit(view)
    expect(getMyMembership).toHaveBeenCalledWith('2026-11-08')
    expect(submitAnalyzeTask).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-08' }))
  })

  it('keeps insufficient same-day photo analysis blocked', async () => {
    storage.set('access_token', 'test-token')
    ;(getMyMembership as jest.Mock).mockResolvedValue({
      is_pro: false, daily_credits_max: 20, system_credits_remaining: 0,
      earned_credits_balance: 0, total_credits_available: 0,
    })
    const view = await mountPage()
    await submit(view)
    expect(submitAnalyzeTask).not.toHaveBeenCalled()
    expect(view.container.querySelector('.confirm-btn')).toHaveTextContent('积分不足')
  })

  it('does not submit old photos or overwrite new-account context after a delayed upload', async () => {
    storage.set('access_token', 'test-token')
    storage.set('analyzeImagePaths', [freshLocalPhoto])
    let finishUpload!: (value: { imageUrl: string }) => void
    ;(uploadAnalyzeImageFile as jest.Mock).mockReturnValue(new Promise(resolve => { finishUpload = resolve }))
    const view = await mountPage()
    await submit(view)
    expect(uploadAnalyzeImageFile).toHaveBeenCalledTimes(1)
    advanceAuthSession()
    storage.set('user_id', 'user-b')
    storage.set('analyzeImagePaths', ['https://fixture.invalid/new-account-photo.jpg'])
    ;(Taro.hideLoading as jest.Mock).mockClear()
    await act(async () => { finishUpload({ imageUrl: freshUploadedPhoto }); await flush() })
    expect(submitAnalyzeTask).not.toHaveBeenCalled()
    expect(Taro.redirectTo).not.toHaveBeenCalled()
    expect(Taro.hideLoading).not.toHaveBeenCalled()
    expect(storage.get('analyzeImagePaths')).toEqual(['https://fixture.invalid/new-account-photo.jpg'])
    expect(view.container.querySelector('.confirm-btn')).not.toHaveClass('disabled')
    expect(view.container.querySelector('.btn-spinner')).toBeNull()
    act(() => jest.advanceTimersByTime(301))
    await submit(view)
    expect(uploadAnalyzeImageFile).toHaveBeenCalledTimes(2)
    expect(submitAnalyzeTask).toHaveBeenCalledTimes(1)
  })
})
