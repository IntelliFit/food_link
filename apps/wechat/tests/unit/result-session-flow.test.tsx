import { act, fireEvent, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { ResultPage } from '../../src/packageExtra/pages/result'
import { clearAnalyzeResultSessionCache, readAnalyzeTaskRecordState, writeAnalyzeTaskRecordState } from '../../src/utils/analyze-result-session'
import { getAnalyzeTask, getFoodRecordById, getHealthProfile, saveFoodRecord, showUnifiedApiError, submitAnalyzeTask } from '../../src/utils/api'

const mockMealImpactShow = jest.fn((_id: string, _summary: unknown, onClose: () => void) => onClose())

jest.mock('@tarojs/components', () => {
  const React = require('react')
  const container = ({ children, ...props }: any) => React.createElement('div', props, children)
  return {
    View: container, ScrollView: container, Swiper: container, SwiperItem: container,
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Image: (props: any) => React.createElement('img', props),
    Slider: (props: any) => React.createElement('input', { ...props, type: 'range' }),
    Input: ({ onInput, type, ...props }: any) => React.createElement('input', {
      ...props, 'data-keyboard-type': type,
      onChange: (event: any) => onInput?.({ detail: { value: event.target.value } }),
    }),
    Textarea: ({ onInput, ...props }: any) => React.createElement('textarea', {
      ...props, onChange: (event: any) => onInput?.({ detail: { value: event.target.value } }),
    }),
  }
})

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: unknown) => Component }))
jest.mock('../../src/utils/api', () => ({
  saveFoodRecord: jest.fn(),
  getFoodRecordById: jest.fn(),
  getAnalyzeTask: jest.fn(),
  getAccessToken: jest.fn(() => 'test-token'),
  getHealthProfile: jest.fn(),
  updateHealthProfile: jest.fn(),
  createUserRecipe: jest.fn(),
  updateAnalysisTaskResult: jest.fn(),
  createPackagedFood: jest.fn(),
  submitAnalyzeTask: jest.fn(),
  submitTextAnalyzeTask: jest.fn(),
  continuePrecisionSession: jest.fn(),
  submitAnalysisFeedback: jest.fn(),
  showUnifiedApiError: jest.fn(),
  ANALYSIS_FEEDBACK_SUBMISSION_ENABLED: false,
}))
jest.mock('../../src/pages/index/components/MealRecordPosterModal', () => ({
  MealRecordPosterModal: ({ visible, record }: { visible: boolean; record: unknown }) => visible
    ? <div data-testid='shared-record'>{JSON.stringify(record)}</div>
    : null,
}))
jest.mock('../../src/components/MealImpactCard', () => ({
  useMealImpactSheet: () => ({ sheet: null, show: mockMealImpactShow }),
  mealSummaryFromSavePayload: () => ({}),
}))
jest.mock('../../src/components/MealDishPrompt', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/AdaptiveImageGrid', () => ({ AdaptiveImageGrid: () => null }))
jest.mock('../../src/components/RecordDateField', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/packageExtra/pages/result/RecordDateChip', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/home-dashboard-local-cache', () => ({
  applyOptimisticFoodRecordToHomeDashboardSnapshot: jest.fn(),
  refreshHomeDashboardLocalSnapshotFromCloud: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../src/utils/infer-default-meal-type', () => ({
  inferDefaultMealTypeFromLocalTime: () => 'lunch',
  getRecommendedMealTypeWithFallback: jest.fn().mockResolvedValue('lunch'),
}))
jest.mock('../../src/utils/membership', () => ({ getFoodCorrectionCreditCost: () => 1 }))

const imageA = 'https://fixture.invalid/meal-A.jpg'
const imageB = 'https://fixture.invalid/meal-B.jpg'
const resultA = {
  description: '第一餐鸡米花',
  items: [{ itemId: 1, name: '第一餐鸡米花', estimatedWeightGrams: 100, nutrients: { calories: 343, protein: 4, carbs: 33, fat: 22, fiber: 0, sugar: 0 } }],
}
const resultB = {
  description: '第二餐手撕猪肉干',
  items: [{ itemId: 1, name: '第二餐手撕猪肉干', estimatedWeightGrams: 45, nutrients: { calories: 108, protein: 18.2, carbs: 1.2, fat: 3.2, fiber: 0, sugar: 0 } }],
}
const recordB = {
  id: 'record-B', source_task_id: 'task-B', user_id: 'user-1', meal_type: 'lunch',
  image_path: imageB, image_paths: [imageB], total_calories: 108, total_protein: 18.2,
  total_carbs: 1.2, total_fat: 3.2, total_weight_grams: 45,
  description: resultB.description,
  items: [{ name: '第二餐手撕猪肉干', weight: 45, intake: 45, ratio: 100, nutrients: resultB.items[0].nutrients }],
}

describe('ResultPage task ownership', () => {
  let storage: Map<string, unknown>
  let didHide: (() => void) | undefined
  let didShow: (() => void) | undefined
  let routeTaskId: string

  const taskB = (recorded = false, recordId?: string) => ({
    id: 'task-B', task_type: 'food', status: 'completed', result: resultB,
    image_url: imageB, image_paths: [imageB], is_recorded: recorded, record_id: recordId,
    payload: { meal_type: 'lunch', record_date: '2026-11-10' },
  })

  const setSnapshot = (taskId: string, result: unknown, image: string) => {
    storage.set('analyzeSourceTaskId', taskId)
    storage.set('analyzeResult', JSON.stringify(result))
    storage.set('analyzeImagePaths', [image])
    storage.set('analyzeImagePath', image)
  }

  const renderResult = async () => {
    const view = render(<ResultPage />)
    await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() })
    return view
  }

  const clickPrimary = async (view: ReturnType<typeof render>) => {
    await act(async () => {
      fireEvent.click(view.container.querySelector('.result-bar__record')!)
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
    })
  }

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-10T04:00:00Z'))
    jest.clearAllMocks()
    clearAnalyzeResultSessionCache()
    storage = new Map<string, unknown>([
      ['user_id', 'user-1'], ['analyzeMealType', 'lunch'],
      ['analyzeTaskIsRecorded', '1'], ['analyzeCommittedRecordId', 'record-A'],
    ])
    didHide = undefined
    didShow = undefined
    routeTaskId = 'task-B'
    ;(globalThis as any).__ENABLE_DEV_DEBUG_UI__ = false
    ;(Taro as any).getCurrentInstance = jest.fn(() => ({ router: { params: { task_id: routeTaskId, date: '2026-11-10' } } }))
    ;(Taro as any).setNavigationBarColor = jest.fn().mockResolvedValue(undefined)
    ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => storage.get(key) ?? '')
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => storage.set(key, value))
    ;(Taro.removeStorageSync as jest.Mock).mockImplementation((key: string) => storage.delete(key))
    ;(Taro.useDidShow as jest.Mock).mockImplementation((callback: () => void) => { didShow = callback })
    ;(Taro.useDidHide as jest.Mock).mockImplementation((callback: () => void) => { didHide = callback })
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(taskB())
    ;(getHealthProfile as jest.Mock).mockResolvedValue({})
    ;(saveFoodRecord as jest.Mock).mockResolvedValue({ id: 'record-B', already_saved: false })
    ;(getFoodRecordById as jest.Mock).mockResolvedValue({ record: recordB })
    setSnapshot('task-B', resultB, imageB)
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it.each([undefined, 'g', 'ml', 'piece', 'serving'] as const)('keeps decimal input while typing and submits its numeric amount (%s)', async (unit) => {
    const measurement = unit ? {
      amount: 45, unit, basis_amount: 100, basis_unit: 'g', unit_conversions: { [unit]: 1 },
      nutrients_per_basis: { calories: 240, protein: 40, carbs: 3, fat: 7 },
    } : undefined
    const result = { ...resultB, items: [{ ...resultB.items[0], measurement }] }
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue({ ...taskB(), result })
    ;(submitAnalyzeTask as jest.Mock).mockResolvedValue({ task_id: 'corrected-task' })
    setSnapshot('task-B', result, imageB)
    const view = await renderResult()
    fireEvent.click(view.container.querySelector('.result-bar__say-send')!)
    const input = view.container.querySelector('.correction-input.weight-input') as HTMLInputElement
    expect(input).toHaveAttribute('data-keyboard-type', 'digit')
    for (const value of ['', '0', '0.', '0.5', '52', '52.', '52.5']) {
      fireEvent.change(input, { target: { value } })
      expect(input.value).toBe(value)
    }
    fireEvent.click(view.container.querySelector('.correction-drawer-overlay .drawer-submit-btn')!)
    const modal = (Taro.showModal as jest.Mock).mock.calls.slice(-1)[0]?.[0]
    expect(modal.title).toBe('重新智能分析')
    await act(async () => { await modal.success({ confirm: true }) })
    const submitted = (submitAnalyzeTask as jest.Mock).mock.calls[0][0].correctionItems[0]
    expect(submitted.weightEdited).toBe(true)
    if (unit) {
      expect(submitted.measurement).toMatchObject({ amount: 52.5, unit })
    } else {
      expect(submitted.weight).toBe(52.5)
    }
  })

  it('resets the unfinished amount when the correction drawer is reopened', async () => {
    const view = await renderResult()
    const open = () => fireEvent.click(view.container.querySelector('.result-bar__say-send')!)
    open()
    const input = view.container.querySelector('.correction-input.weight-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '52.' } })
    expect(input.value).toBe('52.')
    fireEvent.click(view.container.querySelector('.correction-drawer-overlay .drawer-close')!)
    open()
    expect(input.value).toBe('45')
  })

  it.each(['', '.', '0'])('blocks an unfinished or zero correction amount (%s)', async (value) => {
    const view = await renderResult()
    fireEvent.click(view.container.querySelector('.result-bar__say-send')!)
    fireEvent.change(view.container.querySelector('.correction-input.weight-input')!, { target: { value } })
    fireEvent.click(view.container.querySelector('.correction-drawer-overlay .drawer-submit-btn')!)
    expect(Taro.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '请填写大于0的有效份量' }))
    expect(submitAnalyzeTask).not.toHaveBeenCalled()
  })

  it('records meal B after A was saved without sharing, and sends B to the poster', async () => {
    writeAnalyzeTaskRecordState('task-A', true, 'record-A')
    const view = await renderResult()
    expect(view.container.querySelector('.result-bar__record')).toHaveTextContent('记录到11月10日')
    expect(view.container.querySelector('.result-bar__record')).not.toHaveTextContent('分享打卡')
    await clickPrimary(view)
    expect(saveFoodRecord).toHaveBeenCalledTimes(1)
    expect(saveFoodRecord).toHaveBeenCalledWith(expect.objectContaining({
      source_task_id: 'task-B', image_path: imageB, image_paths: [imageB], total_calories: 108,
      items: [expect.objectContaining({ name: '第二餐手撕猪肉干', nutrients: expect.objectContaining({ calories: 108 }) })],
    }))
    const shared = JSON.parse(view.getByTestId('shared-record').textContent || '{}')
    expect(shared).toEqual(expect.objectContaining({ id: 'record-B', source_task_id: 'task-B', image_paths: [imageB], total_calories: 108 }))
    expect(getFoodRecordById).not.toHaveBeenCalledWith('record-A')
    expect(showUnifiedApiError).not.toHaveBeenCalled()
  })

  it('shares the task-owned automatic record without saving again', async () => {
    writeAnalyzeTaskRecordState('task-B', true, 'record-B')
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(taskB(true, 'record-B'))
    const view = await renderResult()
    expect(view.container.querySelector('.result-bar__record')).toHaveTextContent('分享打卡')
    await clickPrimary(view)
    expect(saveFoodRecord).not.toHaveBeenCalled()
    expect(getFoodRecordById).toHaveBeenCalledTimes(1)
    expect(getFoodRecordById).toHaveBeenCalledWith('record-B')
    expect(JSON.parse(view.getByTestId('shared-record').textContent || '{}').image_paths).toEqual([imageB])
  })

  it('resolves a recorded B without record id from B itself instead of borrowing the old global id', async () => {
    writeAnalyzeTaskRecordState('task-B', true)
    ;(getAnalyzeTask as jest.Mock)
      .mockResolvedValueOnce(taskB(true))
      .mockResolvedValueOnce(taskB(true, 'record-B'))
    const view = await renderResult()
    expect(getAnalyzeTask).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('.result-bar__record')).toHaveTextContent('分享打卡')
    await clickPrimary(view)
    expect(getAnalyzeTask).toHaveBeenCalledTimes(2)
    expect(getAnalyzeTask).toHaveBeenCalledWith('task-B')
    expect(getFoodRecordById).toHaveBeenCalledWith('record-B')
    expect(getFoodRecordById).not.toHaveBeenCalledWith('record-A')
    expect(saveFoodRecord).not.toHaveBeenCalled()
  })

  it('fetches B when the route is B but the transfer cache still holds A', async () => {
    setSnapshot('task-A', resultA, imageA)
    const view = await renderResult()
    expect(getAnalyzeTask).toHaveBeenCalledWith('task-B')
    expect(view.container).toHaveTextContent('第二餐手撕猪肉干')
    expect(view.container).not.toHaveTextContent('第一餐鸡米花')
    await clickPrimary(view)
    expect(saveFoodRecord).toHaveBeenCalledWith(expect.objectContaining({ source_task_id: 'task-B', image_paths: [imageB], total_calories: 108 }))
  })

  it('does not open an old share response after the result page is hidden', async () => {
    writeAnalyzeTaskRecordState('task-B', true, 'record-B')
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(taskB(true, 'record-B'))
    let resolveRecord!: (value: unknown) => void
    ;(getFoodRecordById as jest.Mock).mockReturnValue(new Promise(resolve => { resolveRecord = resolve }))
    const view = await renderResult()
    await clickPrimary(view)
    expect(getFoodRecordById).toHaveBeenCalledWith('record-B')
    await act(async () => {
      didHide?.()
      resolveRecord({ record: recordB })
      await Promise.resolve()
    })
    expect(view.queryByTestId('shared-record')).toBeNull()
    expect(saveFoodRecord).not.toHaveBeenCalled()
  })

  it('lets a hidden A save finish for A without changing the newer B session or opening A feedback', async () => {
    routeTaskId = 'task-A'
    setSnapshot('task-A', resultA, imageA)
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue({
      ...taskB(), id: 'task-A', result: resultA, image_url: imageA, image_paths: [imageA],
    })
    let finishSave!: (value: unknown) => void
    ;(saveFoodRecord as jest.Mock).mockReturnValue(new Promise(resolve => { finishSave = resolve }))
    const view = await renderResult()
    await clickPrimary(view)
    expect(saveFoodRecord).toHaveBeenCalledWith(expect.objectContaining({
      source_task_id: 'task-A', image_paths: [imageA], total_calories: 343,
    }))

    await act(async () => {
      didHide?.()
      setSnapshot('task-B', resultB, imageB)
      storage.set('analyzeMealType', 'dinner')
      storage.set('analyzeDietGoal', 'fat_loss')
      writeAnalyzeTaskRecordState('task-B', false)
      finishSave({ id: 'record-A', already_saved: false })
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
    })

    expect(readAnalyzeTaskRecordState('task-A')).toEqual({ recorded: true, recordId: 'record-A' })
    expect(readAnalyzeTaskRecordState('task-B')).toEqual({ recorded: false, recordId: null })
    expect(storage.get('analyzeSourceTaskId')).toBe('task-B')
    expect(JSON.parse(String(storage.get('analyzeResult')))).toEqual(resultB)
    expect(storage.get('analyzeImagePaths')).toEqual([imageB])
    expect(storage.get('analyzeMealType')).toBe('dinner')
    expect(storage.get('analyzeDietGoal')).toBe('fat_loss')
    expect(view.queryByTestId('shared-record')).toBeNull()
    expect(mockMealImpactShow).not.toHaveBeenCalled()
    expect(getFoodRecordById).not.toHaveBeenCalled()
  })

  it('rejects a fetched record whose source task belongs to another recognition', async () => {
    writeAnalyzeTaskRecordState('task-B', true, 'record-B')
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(taskB(true, 'record-B'))
    ;(getFoodRecordById as jest.Mock).mockResolvedValue({ record: { ...recordB, source_task_id: 'task-A' } })
    const view = await renderResult()
    await clickPrimary(view)
    expect(getFoodRecordById).toHaveBeenCalledWith('record-B')
    expect(view.queryByTestId('shared-record')).toBeNull()
    expect(showUnifiedApiError).toHaveBeenCalledWith(expect.any(Error), '打开打卡图失败')
    expect((showUnifiedApiError as jest.Mock).mock.calls[0][0].message).toContain('不匹配')
    expect(saveFoodRecord).not.toHaveBeenCalled()
  })

  it('hides a retained result page when a different account returns to it', async () => {
    const view = await renderResult()
    expect(view.container).toHaveTextContent('第二餐手撕猪肉干')
    expect(getAnalyzeTask).toHaveBeenCalledWith('task-B')
    await act(async () => {
      didHide?.()
      storage.set('user_id', 'user-2')
      didShow?.()
      await Promise.resolve()
    })
    expect(view.container.querySelector('.result-invalid-description')).toHaveTextContent('登录状态已变化')
    expect(view.container).not.toHaveTextContent('第二餐手撕猪肉干')
    expect(view.container.querySelector(`img[src="${imageB}"]`)).toBeNull()
    expect(view.queryByTestId('shared-record')).toBeNull()
    expect(saveFoodRecord).not.toHaveBeenCalled()
  })
  it('records an already-used history result as a new meal on the selected day and shares that copy', async () => {
    ;(Taro as any).getCurrentInstance=jest.fn(()=>({router:{params:{task_id:'task-B',date:'2026-11-08',history_record:'1',copy_record:'1'}}}))
    writeAnalyzeTaskRecordState('task-B',true,'original-record')
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(taskB(true,'original-record'))
    ;(saveFoodRecord as jest.Mock).mockResolvedValue({id:'new-copy',already_saved:false})
    const view=await renderResult()
    expect(view.container.querySelector('.result-bar__record')).toHaveTextContent('再记一份到11月8日')
    await clickPrimary(view)
    expect(saveFoodRecord).toHaveBeenCalledTimes(1)
    expect(saveFoodRecord).toHaveBeenCalledWith(expect.objectContaining({date:'2026-11-08',source_task_id:undefined,entry_type:'analyze_history',image_paths:[imageB]}))
    expect(readAnalyzeTaskRecordState('task-B').recordId).toBe('original-record')
    const shared=JSON.parse(view.getByTestId('shared-record').textContent||'{}')
    expect(shared.id).toBe('new-copy')
    expect(shared.record_time).toContain('2026-11-08')
  })

})
