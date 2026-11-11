import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { MealRecordEditModal } from '../../src/pages/index/components/MealRecordEditModal'
import { updateFoodRecord } from '../../src/utils/api'
import { recalculateSingleFoodItem } from '../../src/utils/single-item-recalculation'
import type { FoodRecord } from '../../src/utils/api'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Button: ({ children, ...props }: any) => React.createElement('button', props, children),
    Slider: ({ value, onChange }: any) => React.createElement('input', {
      type: 'range', 'aria-label': '摄入比例', value,
      onChange: (event: any) => onChange({ detail: { value: Number(event.target.value) } }),
    }),
  }
})
jest.mock('../../src/utils/api', () => ({
  updateFoodRecord: jest.fn(async () => ({})),
  showUnifiedApiError: jest.fn(),
  submitAnalysisFeedback: jest.fn(async () => ({ message: 'feedback submission disabled' })),
}))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/components/MealTypeSelector', () => ({
  MealTypeField: () => null,
  normalizeSelectableMealType: (value: string) => value,
}))
jest.mock('../../src/utils/single-item-recalculation', () => ({
  confirmSingleItemRecalculation: jest.fn(async () => true),
  recalculateSingleFoodItem: jest.fn(),
}))

const record: FoodRecord = {
  id: 'record-volume', user_id: 'test-user', meal_type: 'breakfast',
  total_calories: 150, total_protein: 7.5, total_carbs: 12.5, total_fat: 7.5,
  total_weight_grams: 0, record_time: '2026-11-10T08:00:00+08:00', created_at: '2026-11-10T08:00:00+08:00',
  items: [{
    name: '牛奶', weight: 0, intake: 0, ratio: 100,
    manual_source: 'custom', manual_source_id: 'milk-library',
    measurement: {
      amount: 250, unit: 'ml', basis_amount: 100, basis_unit: 'ml',
      nutrients_per_basis: { calories: 60, protein: 3, carbs: 5, fat: 3 },
    },
    nutrients: { calories: 150, protein: 7.5, carbs: 12.5, fat: 7.5, fiber: 0, sugar: 0 },
  }],
}

describe('saved native quantity editor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(globalThis as any).__ENABLE_DEV_DEBUG_UI__ = false
    ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true })
  })

  it('edits volume and intake ratio without introducing grams into its saved snapshot', async () => {
    const { container } = render(<MealRecordEditModal visible record={record} onClose={jest.fn()} onSuccess={jest.fn()} />)
    expect(await screen.findByText('当前整份营养（250ml）')).toBeInTheDocument()
    expect(screen.queryByText(/每100g参考/)).not.toBeInTheDocument()
    fireEvent.click(container.querySelector('.adjust-btn.plus')!)
    expect(screen.getByText('当前整份营养（260ml）')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('摄入比例'), { target: { value: '50' } })
    expect(screen.getByText('实际摄入 130ml')).toBeInTheDocument()
    fireEvent.click(screen.getByText('保存修改'))
    await waitFor(() => expect(updateFoodRecord).toHaveBeenCalledTimes(1))
    const payload = (updateFoodRecord as jest.Mock).mock.calls[0][1]
    expect(payload.total_calories).toBe(78)
    expect(payload.total_weight_grams).toBe(0)
    expect(payload.items[0]).toEqual(expect.objectContaining({
      measurement: expect.objectContaining({ amount: 260, unit: 'ml', basis_unit: 'ml' }),
      weight: 0, intake: 0, ratio: 50, manual_source: 'custom', manual_source_id: 'milk-library',
    }))
    expect(record.items[0].measurement?.amount).toBe(250)
  })

  it('keeps a label-based native food when renaming instead of sending its volume as AI gram input', async () => {
    ;(Taro.showModal as jest.Mock).mockResolvedValueOnce({ confirm: true, content: '脱脂牛奶' })
    const { container } = render(<MealRecordEditModal visible record={record} onClose={jest.fn()} onSuccess={jest.fn()} />)
    await screen.findByText('当前整份营养（250ml）')
    fireEvent.click(container.querySelector('.edit-icon-wrapper')!)
    expect(await screen.findByText('脱脂牛奶')).toBeInTheDocument()
    expect(recalculateSingleFoodItem).not.toHaveBeenCalled()
    expect(screen.getByText('当前整份营养（250ml）')).toBeInTheDocument()
  })

  it('shows and saves a quarter piece without rounding it to three tenths', async () => {
    const pieceRecord: FoodRecord = {
      ...record,
      items: [{ ...record.items[0], name: '鸡蛋', measurement: { amount: 1, unit: 'piece', basis_amount: 1, basis_unit: 'piece', nutrients_per_basis: { calories: 80 } }, nutrients: { calories: 80, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 } }],
    }
    render(<MealRecordEditModal visible record={pieceRecord} onClose={jest.fn()} onSuccess={jest.fn()} />)
    await screen.findByText('当前整份营养（1个）')
    fireEvent.change(screen.getByLabelText('摄入比例'), { target: { value: '25' } })
    expect(screen.getByText('实际摄入 0.25个')).toBeInTheDocument()
    fireEvent.click(screen.getByText('保存修改'))
    await waitFor(() => expect(updateFoodRecord).toHaveBeenCalledTimes(1))
    const payload = (updateFoodRecord as jest.Mock).mock.calls[0][1]
    expect(payload.total_calories).toBe(20)
    expect(payload.items[0].measurement.amount).toBe(1)
    expect(payload.items[0].ratio).toBe(25)
  })
})
