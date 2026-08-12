import { act, fireEvent, render, screen } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import AnalyzeHistoryPage from '../../src/packageExtra/pages/analyze-history/index'
import { listAnalyzeTasks, showUnifiedApiError } from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/components/AppColorSchemeContext', () => ({
  useAppColorScheme: () => ({ scheme: 'light' }),
}))

jest.mock('../../src/components/CustomNavBar', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
  getNavBarHeight: () => 88,
}))

jest.mock('../../src/components/MealTypeSelector', () => ({
  MealTypeSelectSheet: () => null,
  normalizeSelectableMealType: (_value: unknown, fallback: string) => fallback,
}))

jest.mock('../../src/utils/theme-navigation-bar', () => ({
  applyThemeNavigationBar: jest.fn(),
}))

jest.mock('../../src/utils/home-dashboard-local-cache', () => ({
  applyOptimisticFoodRecordToHomeDashboardSnapshot: jest.fn(),
  refreshHomeDashboardLocalSnapshotFromCloud: jest.fn(),
}))

jest.mock('../../src/utils/api', () => ({
  listAnalyzeTasks: jest.fn(),
  showUnifiedApiError: jest.fn(),
  getAccessToken: jest.fn(() => ''),
  getHealthProfile: jest.fn(),
  deleteAnalysisTask: jest.fn(),
  createUserRecipe: jest.fn(),
  saveFoodRecord: jest.fn(),
  retryAnalyzeTask: jest.fn(),
}))

describe('analyze history loading state', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(Taro.useDidShow as jest.Mock)
      .mockImplementationOnce((callback) => callback())
      .mockImplementation(() => {})
    ;(showUnifiedApiError as jest.Mock).mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    jest.useRealTimers()
  })

  it('replaces the spinner with a persistent retry state when the list request times out', async () => {
    ;(listAnalyzeTasks as jest.Mock).mockReturnValue(new Promise(() => {}))

    render(<AnalyzeHistoryPage />)
    expect(document.querySelector('.loading-spinner-md')).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(12_000)
      await Promise.resolve()
    })

    expect(document.querySelector('.loading-spinner-md')).not.toBeInTheDocument()
    expect(screen.getByText('记录加载失败')).toBeInTheDocument()
    expect(screen.getByText('重新加载')).toBeInTheDocument()

    ;(listAnalyzeTasks as jest.Mock).mockResolvedValue({
      tasks: [{
        id: 'task-1',
        user_id: 'user-1',
        task_type: 'food',
        status: 'done',
        result: { items: [{ name: '番茄炒蛋', nutrients: { calories: 180 } }] },
        created_at: '2026-08-12T12:00:00+08:00',
        updated_at: '2026-08-12T12:00:00+08:00',
      }],
      has_more: false,
      next_offset: 1,
    })

    await act(async () => {
      fireEvent.click(screen.getByText('重新加载'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(listAnalyzeTasks).toHaveBeenCalledTimes(2)
    expect(screen.getByText('番茄炒蛋')).toBeInTheDocument()
  })
})
