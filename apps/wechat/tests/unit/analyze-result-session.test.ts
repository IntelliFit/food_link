import Taro from '@tarojs/taro'
import { getAnalyzeTask, type AnalysisTask, type AnalyzeResponse } from '../../src/utils/api'
import {
  clearAnalyzeResultSessionCache,
  getAnalyzeTaskCommittedRecordId,
  loadAnalyzeResultSnapshot,
  readAnalyzeTaskRecordState,
  updateAnalyzeResultSnapshot,
  writeAnalyzeTaskRecordState,
} from '../../src/utils/analyze-result-session'
import { openAnalyzeTaskFromReminder } from '../../src/utils/open-analyze-task'

jest.mock('../../src/utils/api', () => ({
  getAnalyzeTask: jest.fn(),
  markAnalyzeHistorySeen: jest.fn(() => Promise.resolve()),
}))

const storage = new Map<string, unknown>()
const result = (name: string, calories: number): AnalyzeResponse => ({
  description: name,
  insight: '测试饮食分析',
  items: [{ name, estimatedWeightGrams: 100, originalWeightGrams: 100, nutrients: { calories, protein: 1, carbs: 2, fat: 3, fiber: 0, sugar: 0 } }],
})
const task = (id: string, overrides: Partial<AnalysisTask> = {}): AnalysisTask => ({
  id, user_id: 'user-1', task_type: 'food', status: 'done', is_recorded: false,
  image_paths: [`https://example.test/${id}.jpg`],
  result: result(id, 222), payload: { recorded_on: '2026-11-10', meal_type: 'lunch', diet_goal: 'maintain', activity_timing: 'daily', eating_mood: 'calm' },
  created_at: '2026-11-10T12:00:00+08:00', updated_at: '2026-11-10T12:00:00+08:00', ...overrides,
})
function transfer(id: string, calories: number) {
  storage.set('analyzeSourceTaskId', id)
  storage.set('analyzeResult', JSON.stringify(result(id, calories)))
  storage.set('analyzeImagePaths', [`https://example.test/${id}.jpg`])
  storage.set('analyzeTaskType', 'food')
  storage.set('analyzeMealType', 'dinner')
  storage.set('analyzeDietGoal', 'fat_loss')
}

beforeEach(() => {
  jest.clearAllMocks()
  clearAnalyzeResultSessionCache()
  storage.clear()
  storage.set('user_id', 'user-1')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => storage.delete(key))
  ;(Taro.navigateTo as jest.Mock).mockResolvedValue({})
  ;(Taro.redirectTo as jest.Mock).mockResolvedValue({})
  ;(getAnalyzeTask as jest.Mock).mockReset()
})

describe('record state belongs to one analysis task', () => {
  it('does not mistake task B for the saved task A from legacy global flags', () => {
    storage.set('analyzeTaskIsRecorded', '1')
    storage.set('analyzeCommittedRecordId', 'record-A')
    storage.set('analyzeSourceTaskId', 'task-B')
    expect(readAnalyzeTaskRecordState('task-B')).toEqual({ recorded: false, recordId: null })
  })

  it('can reopen the existing task-keyed saved record map', () => {
    storage.set('analyze_committed_session', JSON.stringify({ 'task-A': { record_id: 'record-A', at: 1 } }))
    expect(readAnalyzeTaskRecordState('task-A')).toEqual({ recorded: true, recordId: 'record-A' })
    expect(getAnalyzeTaskCommittedRecordId('task-B')).toBeNull()
  })

  it('preserves task A while task B is new and removes stale record IDs on B', () => {
    writeAnalyzeTaskRecordState('task-A', true, 'record-A')
    writeAnalyzeTaskRecordState('task-B', true, 'old-record-B')
    writeAnalyzeTaskRecordState('task-B', false)
    expect(getAnalyzeTaskCommittedRecordId('task-A')).toBe('record-A')
    expect(readAnalyzeTaskRecordState('task-B')).toEqual({ recorded: false, recordId: null })
  })

  it('never keeps another record ID when the server says recorded without an ID', () => {
    writeAnalyzeTaskRecordState('task-B', true, 'old-record')
    writeAnalyzeTaskRecordState('task-B', true)
    expect(readAnalyzeTaskRecordState('task-B')).toEqual({ recorded: true, recordId: null })
  })

  it('cannot contaminate B when a save of A finishes after opening B', () => {
    transfer('task-B', 222)
    writeAnalyzeTaskRecordState('task-B', false)
    writeAnalyzeTaskRecordState('task-A', true, 'record-A')
    expect(readAnalyzeTaskRecordState('task-B')).toEqual({ recorded: false, recordId: null })
    expect(storage.get('analyzeSourceTaskId')).toBe('task-B')
    expect(storage.has('analyzeCommittedRecordId')).toBe(false)
  })
})

describe('task-bound result snapshots', () => {
  it('captures the matching photos and nutrition before another task replaces the transfer cache', async () => {
    ;(getAnalyzeTask as jest.Mock)
      .mockResolvedValueOnce(task('task-A', { result: result('task-A', 111) }))
      .mockResolvedValueOnce(task('task-B'))
    transfer('task-A', 111)
    const first = await loadAnalyzeResultSnapshot('task-A')
    transfer('task-B', 222)
    const reopened = await loadAnalyzeResultSnapshot('task-A')
    const second = await loadAnalyzeResultSnapshot('task-B')
    expect(first.result.description).toBe('task-A')
    expect(reopened.imagePaths).toEqual(['https://example.test/task-A.jpg'])
    expect(reopened.result.items[0].nutrients.calories).toBe(111)
    expect(second.imagePaths).toEqual(['https://example.test/task-B.jpg'])
    expect(second.result.items[0].nutrients.calories).toBe(222)
    expect((getAnalyzeTask as jest.Mock).mock.calls).toEqual([['task-A'], ['task-B']])
  })

  it('prefers the authenticated user/task snapshot over later overwritten global photos and nutrition', async () => {
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-A', { result: result('task-A', 111) }))
    transfer('task-A', 111)
    await loadAnalyzeResultSnapshot('task-A')
    transfer('task-A', 999)
    storage.set('analyzeImagePaths', ['https://example.test/task-B.jpg'])
    const reopened = await loadAnalyzeResultSnapshot('task-A')
    expect(reopened.imagePaths).toEqual(['https://example.test/task-A.jpg'])
    expect(reopened.result.items[0].nutrients.calories).toBe(111)
    expect(getAnalyzeTask).toHaveBeenCalledTimes(1)
  })

  it('reopens edited nutrition with its original task photos after another task takes the global cache', async () => {
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-A'))
    await loadAnalyzeResultSnapshot('task-A')
    updateAnalyzeResultSnapshot('task-A', result('edited-task-A', 333))
    transfer('task-B', 999)
    const reopened = await loadAnalyzeResultSnapshot('task-A')
    expect(reopened.result.description).toBe('edited-task-A')
    expect(reopened.result.items[0].nutrients.calories).toBe(333)
    expect(reopened.imagePaths).toEqual(['https://example.test/task-A.jpg'])
    expect(reopened).toMatchObject({ mealType: 'lunch', dietGoal: 'maintain', activityTiming: 'daily' })
    expect(getAnalyzeTask).toHaveBeenCalledTimes(1)
  })

  it('authenticates the task instead of trusting matching global task A after switching to user B', async () => {
    transfer('task-A', 111)
    storage.set('user_id', 'user-2')
    ;(getAnalyzeTask as jest.Mock).mockRejectedValue(new Error('无权读取该识别任务'))
    await expect(loadAnalyzeResultSnapshot('task-A')).rejects.toThrow('无权读取该识别任务')
    expect(getAnalyzeTask).toHaveBeenCalledWith('task-A')
    expect(getAnalyzeTaskCommittedRecordId('task-A')).toBeNull()
  })

  it('loads route task B when globals belong to A, including B meal context, without changing A globals', async () => {
    transfer('task-A', 111)
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-B'))
    const snapshot = await loadAnalyzeResultSnapshot('task-B')
    expect(getAnalyzeTask).toHaveBeenCalledWith('task-B')
    expect(snapshot).toMatchObject({ taskId: 'task-B', imagePaths: ['https://example.test/task-B.jpg'], mealType: 'lunch', dietGoal: 'maintain', activityTiming: 'daily', eatingMood: 'calm' })
    expect(snapshot.result.items[0].nutrients.calories).toBe(222)
    expect(storage.get('analyzeSourceTaskId')).toBe('task-A')
    expect(JSON.parse(storage.get('analyzeResult') as string).description).toBe('task-A')
    expect(storage.get('analyzeMealType')).toBe('dinner')
  })

  it('never retains meal photos for a text task', async () => {
    transfer('task-A', 111)
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('text-task', { task_type: 'food_text', text_input: '一杯牛奶' }))
    expect(await loadAnalyzeResultSnapshot('text-task')).toMatchObject({ taskType: 'food_text', imagePaths: [], textInput: '一杯牛奶' })
  })

  it('rejects a mismatched server task instead of showing another meal', async () => {
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-A'))
    await expect(loadAnalyzeResultSnapshot('task-B')).rejects.toThrow('识别任务不匹配')
    expect(getAnalyzeTaskCommittedRecordId('task-B')).toBeNull()
  })

  it('keeps the result of late task A separate when task B has already become current', async () => {
    let finish!: (value: AnalysisTask) => void
    ;(getAnalyzeTask as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const pending = loadAnalyzeResultSnapshot('task-A')
    transfer('task-B', 222)
    writeAnalyzeTaskRecordState('task-B', false)
    finish(task('task-A', { is_recorded: true, record_id: 'record-A' }))
    expect((await pending).taskId).toBe('task-A')
    expect(storage.get('analyzeSourceTaskId')).toBe('task-B')
    expect(getAnalyzeTaskCommittedRecordId('task-B')).toBeNull()
  })

  it('clears memory snapshots with the user cache', async () => {
    transfer('task-A', 111)
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-A'))
    await loadAnalyzeResultSnapshot('task-A')
    transfer('task-B', 222)
    clearAnalyzeResultSessionCache()
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-A'))
    await loadAnalyzeResultSnapshot('task-A')
    expect((getAnalyzeTask as jest.Mock).mock.calls).toEqual([['task-A'], ['task-A']])
  })

  it('does not reuse another signed-in user’s memory snapshot or delayed response', async () => {
    let finish!: (value: AnalysisTask) => void
    ;(getAnalyzeTask as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const pending = loadAnalyzeResultSnapshot('task-A')
    storage.set('user_id', 'user-2')
    finish(task('task-A', { is_recorded: true, record_id: 'record-A' }))
    await expect(pending).rejects.toThrow('登录状态已变化')
    expect(getAnalyzeTaskCommittedRecordId('task-A')).toBeNull()
  })
})

describe('reminder entry', () => {
  it('opens a new task with its explicit task ID despite a previous meal’s flags', async () => {
    storage.set('analyzeTaskIsRecorded', '1')
    storage.set('analyzeCommittedRecordId', 'record-A')
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-B'))
    await openAnalyzeTaskFromReminder('task-B')
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/result/index?date=2026-11-10&task_id=task-B' })
    expect(readAnalyzeTaskRecordState('task-B')).toEqual({ recorded: false, recordId: null })
    expect((await loadAnalyzeResultSnapshot('task-B')).imagePaths).toEqual(['https://example.test/task-B.jpg'])
  })

  it('opens the auto-recorded task’s own record directly without saving a duplicate', async () => {
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-B', { is_recorded: true, record_id: 'record-B' }))
    await openAnalyzeTaskFromReminder('task-B')
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/record-detail/index?id=record-B&autoPoster=1&from_auto_record=1' })
    expect(getAnalyzeTaskCommittedRecordId('task-B')).toBe('record-B')
  })

  it('clears a previous meal photo if the newly opened photo task has no image URL', async () => {
    transfer('task-A', 111)
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-B', { image_paths: [], image_url: null }))
    await openAnalyzeTaskFromReminder('task-B')
    expect((await loadAnalyzeResultSnapshot('task-B')).imagePaths).toEqual([])
    expect(storage.has('analyzeImagePaths')).toBe(false)
  })

  it('does not borrow the previous meal’s record when a recorded task has no record ID', async () => {
    storage.set('analyzeCommittedRecordId', 'record-A')
    ;(getAnalyzeTask as jest.Mock).mockResolvedValue(task('task-B', { is_recorded: true, record_id: undefined }))
    await openAnalyzeTaskFromReminder('task-B')
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/result/index?date=2026-11-10&task_id=task-B' })
    expect(readAnalyzeTaskRecordState('task-B')).toEqual({ recorded: true, recordId: null })
  })
})
