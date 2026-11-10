import { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import WaterRecordPage from '../../src/packageExtra/pages/water-record'
import WeightRecordPage from '../../src/packageExtra/pages/weight-record'
import * as api from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (component: unknown) => component }))
jest.mock('../../src/utils/api', () => ({ getBodyMetricsSummary: jest.fn(), addBodyWaterLog: jest.fn(), saveBodyWeightRecord: jest.fn(), showUnifiedApiError: jest.fn() }))
jest.mock('../../src/utils/home-dashboard-local-cache', () => ({ addWaterToBodyMetricsStorage: jest.fn(), upsertWeightInBodyMetricsStorage: jest.fn() }))
jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, className, onClick }: any) => React.createElement('div', { className, onClick }, children),
    Text: ({ children, className, onClick }: any) => React.createElement('span', { className, onClick }, children),
    Input: ({ value, className, onInput }: any) => React.createElement('input', { value, className, onChange: (event: any) => onInput({ detail: { value: event.target.value } }) }),
    Picker: ({ children, value, disabled, onChange }: any) => React.createElement('div', {}, children, React.createElement('input', { 'aria-label': '记录日期', type: 'date', value, disabled, onChange: (event: any) => onChange({ detail: { value: event.target.value } }) })),
  }
})

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 10, 10, 12))
  ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: { date: '2026-11-08' } })
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => useEffect(() => { callback() }, []))
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === 'user_id' ? 'A' : '2026-11-10')
  ;(api.getBodyMetricsSummary as jest.Mock).mockResolvedValue({ water_goal_ml: 2000, water_days: [], weight_entries: [{ date: '2026-11-08', value: 68 }, { date: '2026-11-09', value: 69 }], latest_weight: { value: 70 } })
  ;(api.addBodyWaterLog as jest.Mock).mockResolvedValue({ item: { id: 'water-1', amount_ml: 250 } })
  ;(api.saveBodyWeightRecord as jest.Mock).mockResolvedValue({ item: { id: 'weight-1' } })
})
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers() })

it('adds water to the displayed historical day instead of shared storage today', async () => {
  const view = render(<WaterRecordPage />); await act(flush)
  await act(async () => { fireEvent.click(view.container.querySelectorAll('.water-preset')[1]); await flush() })
  expect(api.addBodyWaterLog).toHaveBeenCalledWith(250, '2026-11-08')
  expect(view.container).toHaveTextContent('正在补录 · 11月8日')
})

it('switching weight day updates the input and saves to that day without reusing the previous value', async () => {
  const view = render(<WeightRecordPage />); await act(flush)
  expect(view.container.querySelector('input.weight-main-input')).toHaveValue('68')
  fireEvent.change(screen.getByLabelText('记录日期'), { target: { value: '2026-11-09' } })
  expect(view.container.querySelector('input.weight-main-input')).toHaveValue('69')
  await act(async () => { fireEvent.click(screen.getByText('保存体重')); await flush() })
  expect(api.saveBodyWeightRecord).toHaveBeenCalledWith(69, '2026-11-09', expect.stringContaining('weight-2026-11-09-'))
})
