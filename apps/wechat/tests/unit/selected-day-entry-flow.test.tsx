import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import RecipesPage from '../../src/packageExtra/pages/recipes'
import RecipeDetailPage from '../../src/packageExtra/pages/recipe-detail'
import SupplementsPage from '../../src/packageExtra/pages/supplements'
import AnalyzeHistoryPage from '../../src/packageExtra/pages/analyze-history'
import RecordManualPage from '../../src/packageExtra/pages/record-manual'
import { TodaySupplementsSection } from '../../src/pages/index/components/TodaySupplementsSection'
import * as api from '../../src/utils/api'
import { consumeRecordReturnDate } from '../../src/utils/record-navigation'
import { readAnalyzeTaskRecordState, writeAnalyzeTaskRecordState } from '../../src/utils/analyze-result-session'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (component: unknown) => component }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }), useAppColorSchemeOptional: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/components/CustomNavBar', () => ({ __esModule: true, default: ({ title }: any) => <div>{title}</div>, getNavBarHeight: () => 80 }))
jest.mock('../../src/components/MealImpactCard', () => ({ useMealImpactSheet: () => ({ sheet: null, show: (_id: string, _summary: unknown, done: (shown: boolean) => void) => done(false) }) }))
jest.mock('../../src/utils/home-dashboard-local-cache', () => ({
  refreshHomeDashboardLocalSnapshotFromCloud: jest.fn().mockResolvedValue(true),
  applyOptimisticFoodRecordToHomeDashboardSnapshot: jest.fn(),
}))
jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(() => 'token-A'), getHealthProfile: jest.fn(),
  getUserRecipes: jest.fn(), getUserRecipe: jest.fn(), applyUserRecipe: jest.fn(),
  deleteUserRecipe: jest.fn(), updateUserRecipe: jest.fn(),
  getSupplementDashboard: jest.fn(), recordSupplementIntake: jest.fn(),
  deleteSupplement: jest.fn(), deleteSupplementIntake: jest.fn(),
  listAnalyzeTaskSummaries: jest.fn(), getAnalyzeTask: jest.fn(), saveFoodRecord: jest.fn(),
  deleteAnalysisTask: jest.fn(), createUserRecipe: jest.fn(), retryAnalyzeTask: jest.fn(), showUnifiedApiError: jest.fn(),
  fetchManualFoodCatalog: jest.fn(), fetchManualCustomFoods: jest.fn(), searchManualFood: jest.fn(),
}))

const nutrients = { calories: 120, protein: 3, carbs: 25, fat: 1, fiber: 0, sugar: 0 }
const recipe = { id: 'fav-1', user_id: 'A', recipe_name: '收藏米饭', is_favorite: true, meal_type: 'lunch', items: [{ name: '米饭', weight: 100, ratio: 100, intake: 100, nutrients }], total_calories: 120, total_protein: 3, total_carbs: 25, total_fat: 1, total_weight_grams: 100, tags: [] }
const supplement = { id: 'supp-1', name: '维生素C', default_servings: 1, serving_label: '粒', components: [], schedule_enabled: true, status: 'active' }
const task = (recorded = false) => ({ id: 'task-1', status: 'done', task_type: 'food', has_result: true, is_recorded: recorded, record_id: recorded ? 'original-record' : undefined, created_at: '2026-11-10T04:00:00Z', payload: { date: '2026-11-10', meal_type: 'lunch' }, result_summary: { food_names: ['米饭'], total_calories: 120 }, result: { items: [{ itemId: 1, name: '米饭', estimatedWeightGrams: 100, nutrients }] } })
const store = new Map<string, any>()
let route: Record<string, string>
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
async function mount(component: React.ReactElement) { const view = render(component); await act(flush); await act(async () => { jest.advanceTimersByTime(100); await flush() }); return view }
async function click(element: Element) { await act(async () => { fireEvent.click(element); await flush() }) }

beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 10, 10, 12))
  route = { date: '2026-11-08', id: 'fav-1' }
  store.clear(); store.set('user_id', 'A'); store.set('access_token', 'token-A')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => store.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => store.set(key, value))
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => store.delete(key))
  ;(Taro.useRouter as jest.Mock).mockImplementation(() => ({ params: route }))
  ;(Taro as any).getCurrentInstance = jest.fn(() => ({ router: { params: route } }))
  ;(Taro.useDidShow as jest.Mock).mockImplementation((callback: () => void) => React.useEffect(() => { callback() }, []))
  ;(Taro as any).showActionSheet = jest.fn().mockResolvedValue({ tapIndex: 2 })
  ;(Taro as any).stopPullDownRefresh = jest.fn()
  ;(Taro.switchTab as jest.Mock).mockResolvedValue({})
  ;(api.getHealthProfile as jest.Mock).mockResolvedValue({})
  ;(api.getUserRecipes as jest.Mock).mockResolvedValue({ recipes: [recipe] })
  ;(api.getUserRecipe as jest.Mock).mockResolvedValue(recipe)
  ;(api.applyUserRecipe as jest.Mock).mockResolvedValue({ id: 'favorite-record' })
  ;(api.getSupplementDashboard as jest.Mock).mockResolvedValue({ supplements: [supplement], intakes: [], planned_count: 1, completed_count: 0 })
  ;(api.recordSupplementIntake as jest.Mock).mockResolvedValue({ id: 'intake-1' })
  ;(api.listAnalyzeTaskSummaries as jest.Mock).mockResolvedValue({ tasks: [task()], has_more: false })
  ;(api.getAnalyzeTask as jest.Mock).mockResolvedValue(task())
  ;(api.saveFoodRecord as jest.Mock).mockResolvedValue({ id: 'new-record', already_saved: false })
  ;(api.fetchManualCustomFoods as jest.Mock).mockResolvedValue({ items: [] })
  ;(api.fetchManualFoodCatalog as jest.Mock).mockResolvedValue({ page: 1, has_more: false, items: [{ id: 'rice', source: 'nutrition_library', title: '米饭', total_calories: 120, total_protein: 3, total_carbs: 25, total_fat: 1, total_weight_grams: 100 }] })
})
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers() })

it('carries the selected date from favorites into detail and meal selection, then returns to that day', async () => {
  const view = await mount(<RecipesPage />)
  await click(view.container.querySelector('.use-btn')!)
  expect(Taro.showActionSheet).toHaveBeenCalledWith(expect.objectContaining({ alertText: '记录到11月8日：收藏米饭' }))
  expect(api.applyUserRecipe).toHaveBeenCalledWith('fav-1', 'lunch', 'favorite_recipe', '2026-11-08')
  expect(consumeRecordReturnDate()).toBe('2026-11-08')
  await act(async () => { jest.advanceTimersByTime(600); await flush() })
  expect(Taro.switchTab).toHaveBeenCalledWith({ url: '/pages/index/index' })
})
it('favorite detail saves on its own route day despite stale shared storage', async () => {
  store.set('recordTargetDate', '2026-11-10')
  await mount(<RecipeDetailPage />)
  await click(screen.getByText('记录到11月8日'))
  expect(api.applyUserRecipe).toHaveBeenCalledWith('fav-1', 'lunch', 'favorite_recipe', '2026-11-08')
})
it('manual library confirms and saves its own selected day after shared storage changes', async () => {
  const view = await mount(<RecordManualPage />)
  await click(view.container.querySelector('.add-btn')!)
  await click(view.container.querySelector('.save-btn')!)
  store.set('recordTargetDate', '2026-11-10')
  await click(screen.getByText('确认记录到11月8日'))
  expect(api.saveFoodRecord).toHaveBeenCalledTimes(1)
  expect(api.saveFoodRecord).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-08', items: [expect.objectContaining({ name: '米饭' })] }))
  expect(consumeRecordReturnDate()).toBe('2026-11-08')
})
it('records a supplement on the selected day and refreshes that day, not today', async () => {
  await mount(<SupplementsPage />)
  expect(api.getSupplementDashboard).toHaveBeenCalledWith('2026-11-08')
  await click(screen.getByText('记录到11月8日'))
  expect(api.recordSupplementIntake).toHaveBeenCalledWith('supp-1', expect.objectContaining({ servings: 1, taken_at: expect.stringMatching(/^2026-11-08T.*\+08:00$/) }))
  expect(Taro.eventCenter.trigger).toHaveBeenCalledWith(expect.any(String), { date: '2026-11-08', force: true })
  expect(consumeRecordReturnDate()).toBe('2026-11-08')
})
it('home supplement quick record inherits the home day without opening today cabinet', async () => {
  const recorded = jest.fn()
  const view = await mount(<TodaySupplementsSection date='2026-11-08' summary={{ planned_count: 1, completed_count: 0, pending_supplement: supplement as any, functional_components: [], additional_nutrients: [], duplicate_components: [] }} onRecorded={recorded} />)
  await click(view.container.querySelector('.today-supplements-record')!)
  expect(api.recordSupplementIntake).toHaveBeenCalledWith('supp-1', expect.objectContaining({ taken_at: expect.stringMatching(/^2026-11-08T/) }))
  expect(recorded).toHaveBeenCalledWith(expect.objectContaining({ completed_count: 1 }), '2026-11-08')
  expect(Taro.navigateTo).not.toHaveBeenCalled()
})
it.each([false, true])('records a history snapshot to the selected day, preserving recorded original=%s', async recorded => {
  ;(api.listAnalyzeTaskSummaries as jest.Mock).mockResolvedValue({ tasks: [task(recorded)], has_more: false })
  ;(api.getAnalyzeTask as jest.Mock).mockResolvedValue(task(recorded))
  if (recorded) writeAnalyzeTaskRecordState('task-1', true, 'original-record')
  const view = await mount(<AnalyzeHistoryPage />)
  await click(view.container.querySelector('.history-record-action')!)
  await click(screen.getByText('确认记到11月8日'))
  expect(api.saveFoodRecord).toHaveBeenCalledTimes(1)
  expect(api.saveFoodRecord).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-08', source_task_id: recorded ? undefined : 'task-1', entry_type: 'analyze_history', total_calories: 120 }))
  if (recorded) expect(readAnalyzeTaskRecordState('task-1').recordId).toBe('original-record')
})
it('history detail carries the target date and explicit copy intent for an already recorded task', async () => {
  ;(api.listAnalyzeTaskSummaries as jest.Mock).mockResolvedValue({ tasks: [task(true)], has_more: false })
  ;(api.getAnalyzeTask as jest.Mock).mockResolvedValue(task(true))
  const view = await mount(<AnalyzeHistoryPage />)
  await click(view.container.querySelector('.task-card')!)
  expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/result/index?date=2026-11-08&task_id=task-1&history_record=1&copy_record=1' })
})
