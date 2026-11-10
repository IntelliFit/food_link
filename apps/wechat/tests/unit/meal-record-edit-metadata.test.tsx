import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { MealRecordEditModal } from '../../src/pages/index/components/MealRecordEditModal'
import { updateFoodRecord, type FoodRecord, type FoodRecordItemRow } from '../../src/utils/api'

jest.mock('../../src/utils/api', () => ({
  updateFoodRecord: jest.fn(),
  submitAnalysisFeedback: jest.fn().mockResolvedValue({}),
  showUnifiedApiError: jest.fn(),
}))
jest.mock('../../src/components/AppColorSchemeContext', () => ({
  useAppColorScheme: () => ({ scheme: 'light' }),
}))
jest.mock('../../src/utils/single-item-recalculation', () => ({
  confirmSingleItemRecalculation: jest.fn(),
  recalculateSingleFoodItem: jest.fn(),
}))
jest.mock('@tarojs/components', () => {
  const ReactModule = require('react')
  return {
    View: ({ children, className, onClick }: any) => ReactModule.createElement('div', { className, onClick }, children),
    Text: ({ children, className, onClick }: any) => ReactModule.createElement('span', { className, onClick }, children),
    Button: ({ children, onClick, disabled }: any) => ReactModule.createElement('button', { onClick, disabled }, children),
    Slider: ({ value, onChange }: any) => ReactModule.createElement('input', {
      type: 'range', value,
      onChange: (event: any) => onChange({ detail: { value: Number(event.target.value) } }),
    }),
  }
})

const makeRecord = (source: FoodRecordItemRow['manual_source']): FoodRecord => ({
  id: `record-${source}`, user_id: 'user-A', meal_type: 'morning_snack',
  items: [{
    name: '三元有机牛奶', weight: 250, ratio: 100, intake: 250,
    manual_source: source, manual_source_id: `source-${source}`,
    manual_source_title: '三元有机牛奶 250ml', manual_portion_label: '1盒（250ml）',
    image_path: 'foods/milk-front.jpg', image_paths: ['foods/milk-front.jpg', 'foods/milk-label.jpg'],
    nutrients: { calories: 150, protein: 8, carbs: 12, fat: 8, fiber: 0, sugar: 0 },
  }],
  total_calories: 150, total_protein: 8, total_carbs: 12, total_fat: 8,
  total_weight_grams: 250, record_time: '2026-11-10T10:00:00+08:00', created_at: '2026-11-10T10:00:00+08:00',
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(globalThis as any).__ENABLE_DEV_DEBUG_UI__ = false
  ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true })
  ;(updateFoodRecord as jest.Mock).mockResolvedValue({})
})

it.each(['public_library', 'nutrition_library', 'packaged_food', 'custom'] as const)(
  'preserves %s source, portion and item photos when only the meal changes', async source => {
    const record = makeRecord(source)
    render(<MealRecordEditModal visible record={record} onClose={jest.fn()} onSuccess={jest.fn()} />)
    fireEvent.click(screen.getByText('晚加餐'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存修改' })) })
    await waitFor(() => expect(updateFoodRecord).toHaveBeenCalledTimes(1))
    const [id, payload] = (updateFoodRecord as jest.Mock).mock.calls[0]
    expect(id).toBe(record.id)
    expect(payload.meal_type).toBe('evening_snack')
    expect(payload.items[0]).toEqual(expect.objectContaining({
      ...record.items[0], nutrients: expect.objectContaining(record.items[0].nutrients),
    }))
    expect(payload.total_calories).toBe(150)
  },
)

it('preserves the source snapshot and only scales intake when its slider changes', async () => {
  const record = makeRecord('packaged_food')
  render(<MealRecordEditModal visible record={record} onClose={jest.fn()} onSuccess={jest.fn()} />)
  fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存修改' })) })
  await waitFor(() => expect(updateFoodRecord).toHaveBeenCalledTimes(1))
  const payload = (updateFoodRecord as jest.Mock).mock.calls[0][1]
  expect(payload.items[0]).toEqual(expect.objectContaining({
    ...record.items[0], ratio: 50, intake: 125, nutrients: expect.objectContaining(record.items[0].nutrients),
  }))
  expect(payload.total_calories).toBe(75)
  expect(record.items[0].ratio).toBe(100)
})
