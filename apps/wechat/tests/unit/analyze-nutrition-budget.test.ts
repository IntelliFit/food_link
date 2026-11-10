import { getHomeDashboard, type HomeDashboard } from '../../src/utils/api'
import {
  ANALYZE_NUTRITION_BUDGET_TIMEOUT_MS,
  analyzeNutritionBudgetFromDashboard,
  loadAnalyzeNutritionBudget,
} from '../../src/utils/analyze-nutrition-budget'

jest.mock('../../src/utils/api', () => ({ getHomeDashboard: jest.fn() }))

function dashboard(target = 2100, current = 1600, goal = 'fat_loss'): HomeDashboard {
  return {
    intakeData: {
      target, current, progress: current / target,
      macros: {
        protein: { current: 70, target: 100 },
        carbs: { current: 150, target: 200 },
        fat: { current: 40, target: 60 },
      },
    },
    nutritionTarget: { diet_goal: goal },
    meals: [],
  }
}

describe('analysis nutrition budget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('uses the saved daily target minus actual intake and the actual diet goal', () => {
    const input = dashboard()
    expect(analyzeNutritionBudgetFromDashboard(input)).toEqual({
      remaining_calories: 500,
      diet_goal: 'fat_loss',
      user_goal: 'fat_loss',
    })
    expect(input.intakeData).toMatchObject({ target: 2100, current: 1600 })
  })

  it.each(['muscle_gain', 'maintain'])('preserves the %s goal instead of forcing none', (goal) => {
    expect(analyzeNutritionBudgetFromDashboard(dashboard(2100, 1600, goal))).toEqual({
      remaining_calories: 500, diet_goal: goal, user_goal: goal,
    })
  })

  it('keeps an explicit none goal without turning it into a user goal', () => {
    expect(analyzeNutritionBudgetFromDashboard(dashboard(2100, 1600, 'none'))).toEqual({
      remaining_calories: 500, diet_goal: 'none',
    })
  })

  it('keeps a known exhausted budget as zero', () => {
    expect(analyzeNutritionBudgetFromDashboard(dashboard(1600, 1800))).toMatchObject({ remaining_calories: 0 })
  })

  it.each([
    [undefined, 1600], [null, 1600], [0, 1600], [-20, 1600], [Infinity, 1600],
    [2100, undefined], [2100, null], [2100, -1], [2100, NaN], [2100, Infinity], ['2100', 1600],
  ])('does not turn invalid target/intake (%s, %s) into a zero budget', (target, current) => {
    const input = { ...dashboard(), intakeData: { target, current } } as unknown as HomeDashboard
    expect(analyzeNutritionBudgetFromDashboard(input)).toEqual({ diet_goal: 'fat_loss', user_goal: 'fat_loss' })
  })

  it('omits unknown goals and missing dashboard data', () => {
    expect(analyzeNutritionBudgetFromDashboard(dashboard(2100, 1600, 'unknown'))).toEqual({ remaining_calories: 500 })
    expect(analyzeNutritionBudgetFromDashboard(null)).toEqual({})
    expect(analyzeNutritionBudgetFromDashboard(undefined)).toEqual({})
  })

  it('requests the chosen record date and fetches a fresh budget for each meal', async () => {
    const fetchDashboard = getHomeDashboard as jest.Mock
    fetchDashboard.mockResolvedValueOnce(dashboard()).mockResolvedValueOnce(dashboard(2100, 1900))
    await expect(loadAnalyzeNutritionBudget('2026-11-08')).resolves.toMatchObject({ remaining_calories: 500 })
    await expect(loadAnalyzeNutritionBudget('2026-11-08')).resolves.toMatchObject({ remaining_calories: 200 })
    expect(fetchDashboard.mock.calls).toEqual([['2026-11-08'], ['2026-11-08']])
    expect(jest.getTimerCount()).toBe(0)
  })

  it('skips the lookup when suggestions are disabled', async () => {
    await expect(loadAnalyzeNutritionBudget('2026-11-08', { enabled: false })).resolves.toEqual({})
    expect(getHomeDashboard).not.toHaveBeenCalled()
  })

  it('does not silently substitute today when the intended date is missing', async () => {
    await expect(loadAnalyzeNutritionBudget('')).resolves.toEqual({})
    expect(getHomeDashboard).not.toHaveBeenCalled()
  })

  it('lets recognition proceed without a fabricated budget if the dashboard fails', async () => {
    ;(getHomeDashboard as jest.Mock).mockRejectedValue(new Error('dashboard unavailable'))
    await expect(loadAnalyzeNutritionBudget('2026-11-08')).resolves.toEqual({})
    expect(jest.getTimerCount()).toBe(0)
  })

  it('bounds a slow lookup and ignores its late result', async () => {
    let resolveDashboard: ((value: HomeDashboard) => void) | undefined
    const fetchDashboard = jest.fn(() => new Promise<HomeDashboard>((resolve) => { resolveDashboard = resolve }))
    const pending = loadAnalyzeNutritionBudget('2026-11-08', { fetchDashboard })
    await Promise.resolve()
    jest.advanceTimersByTime(ANALYZE_NUTRITION_BUDGET_TIMEOUT_MS)
    await expect(pending).resolves.toEqual({})
    resolveDashboard?.(dashboard())
    await Promise.resolve()
    await expect(pending).resolves.toEqual({})
    expect(jest.getTimerCount()).toBe(0)
  })
})
