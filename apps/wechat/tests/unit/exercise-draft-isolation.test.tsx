import React from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import ExerciseRecordPage from '../../src/packageExtra/pages/exercise-record'
import { createExerciseLog, getAnalyzeTask, getExerciseLogs, getMyMembership } from '../../src/utils/api'

jest.mock('../../src/utils/api', () => ({
  getAccessToken: () => 'exercise-token',
  createExerciseLog: jest.fn(), getAnalyzeTask: jest.fn(), getExerciseLogs: jest.fn(), getMyMembership: jest.fn(),
  sanitizeUserFacingErrorMessage: (value: string) => value,
  showUnifiedApiError: jest.fn(), uploadAnalyzeImageFile: jest.fn(), compressImagePathForUpload: jest.fn(),
}))
jest.mock('../../src/utils/membership', () => ({
  getExerciseLogCreditBlockMessage: () => '', isExerciseLogCreditExhausted: () => false,
}))
jest.mock('../../src/components/CreditShortageSheet', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/utils/feed-share', () => ({
  markRecordVisibilityNoticeDue() {}, remindRecordVisibilityOnce: async () => {},
}))
jest.mock('@tarojs/components', () => {
  const R = require('react')
  return {
    View: ({ children, ...props }: any) => R.createElement('div', props, children),
    Text: ({ children, ...props }: any) => R.createElement('span', props, children),
    Picker: ({ children, range, onChange }: any) => R.createElement('div', {}, children, R.createElement('select', { 'aria-label': '记录日期', onChange: (event: any) => onChange({ detail: { value: Number(event.target.value) } }) }, range.map((label: string, value: number) => R.createElement('option', { key: value, value }, label)))),
    ScrollView: ({ children, ...props }: any) => R.createElement('div', props, children),
    Image: () => null, Input: () => null,
    Textarea: ({ onInput, value, className, disabled }: any) => R.createElement('textarea', {
      value, className, disabled, onChange: (event: any) => onInput({ detail: { value: event.target.value } }),
    }),
  }
})

async function flush() {
  for (let index = 0; index < 15; index++) await Promise.resolve()
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-11-10T04:00:00Z'))
  const storage = new Map<string, unknown>()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => storage.set(key, value))
  ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
  ;(Taro as any).getCurrentInstance = () => ({ router: { params: { date: '2026-11-10' } } })
  ;(getExerciseLogs as jest.Mock).mockResolvedValue({ logs: [] })
  ;(getMyMembership as jest.Mock).mockResolvedValue({})
  ;(createExerciseLog as jest.Mock).mockResolvedValue({ task_id: 'task-A' })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test.each(['done', 'failed'])('旧任务%s时保留下一条尚未提交的运动草稿', async (status) => {
  let finishTask: (value: unknown) => void = () => {}
  ;(getAnalyzeTask as jest.Mock).mockImplementation(() => new Promise(resolve => { finishTask = resolve }))
  const view = render(<ExerciseRecordPage />)
  await act(flush)
  const input = view.container.querySelector('textarea.chat-input') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '跑步30分钟' } })
  await act(async () => {
    fireEvent.click(view.container.querySelector('.exercise-send-trigger')!)
    await flush()
  })
  expect(createExerciseLog).toHaveBeenCalledTimes(1)
  expect(input.value).toBe('')
  expect(input.disabled).toBe(false)

  const draft = '第二条：散步45分钟，还没写完'
  fireEvent.change(input, { target: { value: draft } })
  await act(async () => {
    finishTask({ status, result: { exercise_log: { id: 'record-A' }, estimated_calories: 123 }, error_message: '分析失败' })
    await flush()
  })
  expect(input.value).toBe(draft)
  expect(createExerciseLog).toHaveBeenCalledTimes(1)
  if (status === 'done') expect(Taro.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '已记录 123 kcal' }))
})

test('运动按日期栏选择的历史日提交，返回页面时不恢复成原路由日期', async () => {
  let show: () => void = () => {}
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => { show = callback })
  ;(getAnalyzeTask as jest.Mock).mockReturnValue(new Promise(() => {}))
  const view = render(<ExerciseRecordPage />); await act(flush)
  fireEvent.change(view.getByLabelText('记录日期'), { target: { value: '2' } })
  await act(async () => { show(); await flush() })
  fireEvent.change(view.container.querySelector('textarea.chat-input')!, { target: { value: '散步20分钟' } })
  await act(async () => { fireEvent.click(view.container.querySelector('.exercise-send-trigger')!); await flush() })
  expect(createExerciseLog).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-08', exercise_desc: '散步20分钟' }))
  expect(view.container).toHaveTextContent('正在补录 · 11月8日')
})
