import Taro from '@tarojs/taro'
import {
  customFocusCardFromTask,
  readPendingCustomFocusTasks,
  removePendingCustomFocusTask,
  savePendingCustomFocusTask,
} from '../../src/utils/custom-focus-task'
import type { AnalysisTask } from '../../src/utils/api'

describe('custom focus background tasks', () => {
  const storage = new Map<string, unknown>()

  beforeEach(() => {
    storage.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => storage.get(key))
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => storage.set(key, value))
  })

  it('persists a pending task so another page visit can resume it', () => {
    savePendingCustomFocusTask({
      taskId: 'task-1',
      range: 'week',
      focusId: 'focus-1',
      focusKey: 'custom:focus-1',
      createdAt: 1000,
    })

    expect(readPendingCustomFocusTasks(2000)).toEqual([expect.objectContaining({ taskId: 'task-1' })])

    removePendingCustomFocusTask('task-1')
    expect(readPendingCustomFocusTasks(2000)).toEqual([])
  })

  it('restores the generated card from the authoritative analysis task result', () => {
    const task = {
      id: 'task-1',
      user_id: 'user-1',
      task_type: 'custom_focus',
      status: 'done',
      result: {
        card: {
          key: 'custom:focus-1',
          title: '力量提升',
          score: 64,
          tone: 'neutral',
          brief: '训练支持度改善',
          summary: 'summary',
          basis: 'basis',
          action: 'action',
          delta: 5,
          previous_score: 58,
          score_change: 6,
          change_reason: '训练记录增加。',
        },
      },
      created_at: '2026-09-14T00:00:00Z',
      updated_at: '2026-09-14T00:00:10Z',
    } as AnalysisTask

    expect(customFocusCardFromTask(task)).toEqual(expect.objectContaining({
      score: 64,
      previous_score: 58,
      score_change: 6,
    }))
  })
})
