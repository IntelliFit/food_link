import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import RecordDateField from '../../src/components/RecordDateField'

jest.mock('@tarojs/components', () => {
  const ReactModule = require('react')
  return {
    View: ({ children, onClick, className, role }: any) => ReactModule.createElement('div', { onClick, className, role }, children),
    Text: ({ children }: any) => ReactModule.createElement('span', null, children),
    Picker: ({ children, range, value, mode, onChange, disabled }: any) => ReactModule.createElement('div', null, children,
      ReactModule.createElement('select', { 'aria-label': '记录日期', disabled, value, onChange: (e: any) => onChange({ detail: { value: mode === 'date' ? e.target.value : Number(e.target.value) } }) },
        (range || ['2026-11-08', '2026-11-10']).map((label: string, i: number) => ReactModule.createElement('option', { key: label, value: mode === 'date' ? label : i }, label)))),
  }
})
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 10, 10, 12))
  ;(Taro.getStorageSync as jest.Mock).mockReturnValue('user-A')
})
afterEach(() => { jest.useRealTimers() })

it('makes the past date and returning to today visible without opening a hidden menu', () => {
  const change = jest.fn()
  render(<RecordDateField date='2026-11-08' onChange={change} />)
  expect(screen.getByText('正在补录 · 11月8日')).toBeVisible()
  expect(screen.getByText('切换日期 ›')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '回到今天' }))
  expect(change).toHaveBeenCalledWith('2026-11-10')
})
it('changes the target day explicitly and preserves disabled state while saving', () => {
  const change = jest.fn()
  const view = render(<RecordDateField date='2026-11-10' onChange={change} />)
  fireEvent.change(screen.getByLabelText('记录日期'), { target: { value: '2' } })
  expect(change).toHaveBeenCalledWith('2026-11-08')
  view.rerender(<RecordDateField date='2026-11-08' onChange={change} disabled />)
  expect(screen.getByLabelText('记录日期')).toBeDisabled()
  expect(screen.queryByText('回到今天')).toBeNull()
})
