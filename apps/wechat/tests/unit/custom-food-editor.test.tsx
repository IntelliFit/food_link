import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import { CustomFoodEditor, type CustomFoodEditorDraft } from '../../src/packageExtra/pages/record-manual/CustomFoodEditor'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Image: ({ mode: _mode, ...props }: any) => React.createElement('img', props),
    Input: ({ onInput, type: _type, ...props }: any) => React.createElement('input', {
      ...props, onChange: (event: any) => onInput?.({ detail: { value: event.target.value } }),
    }),
  }
})

const draft: CustomFoodEditorDraft = {
  name: '', weight: '100', nutritionBasis: '100', energyUnit: 'kj', calories: '',
  protein: '', carbs: '', fat: '', category: 'custom', images: [], microValues: {},
}

function editor(props: Partial<React.ComponentProps<typeof CustomFoodEditor>> = {}) {
  return <CustomFoodEditor
    value={draft}
    microFields={[{ key: 'sodium_mg', label: '钠', unit: 'mg' }]}
    onChange={jest.fn()} onMicroChange={jest.fn()} onChooseImages={jest.fn()}
    onImportPackage={jest.fn()} onPreviewImage={jest.fn()} onSave={jest.fn()}
    onCancel={jest.fn()} onCollapse={jest.fn()} {...props}
  />
}

describe('CustomFoodEditor', () => {
  it('starts with three inputs and exposes the default portion before saving', () => {
    render(editor())
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
    expect(screen.getByText('保存后默认一份：100g')).toBeInTheDocument()
    expect(screen.queryByText('默认一份数量 g')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('调整'))
    expect(screen.getByText('默认一份数量 g')).toBeInTheDocument()
  })

  it('keeps imported nutrition and photos visible as summaries without requiring re-entry', () => {
    render(editor({ value: { ...draft, weight: '75', protein: '5', carbs: '40', images: ['food.jpg'], category: 'snack', microValues: { sodium_mg: '300' } } }))
    expect(screen.getByText('蛋白质 5g · 碳水 40g · 1项其他营养')).toBeInTheDocument()
    expect(screen.getByText('1张照片 · 归入零食')).toBeInTheDocument()
    expect(screen.getByText('保存后默认一份：75g')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
  })

  it('reveals optional macros and micronutrients progressively', () => {
    render(editor())
    fireEvent.click(screen.getByText('补充营养（选填）'))
    expect(screen.getAllByRole('textbox')).toHaveLength(6)
    fireEvent.click(screen.getByText('维生素 / 矿物质（选填）'))
    expect(screen.getByText('钠 mg / 每100g')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(7)
  })

  it('preserves edited optional values when sections are collapsed and saved', () => {
    const save = jest.fn()
    function Harness() {
      const [value, setValue] = useState({ ...draft, name: '家里卤牛肉', calories: '500' })
      return editor({ value, onChange: (patch) => setValue((old) => ({ ...old, ...patch })), onSave: () => save(value) })
    }
    render(<Harness />)
    fireEvent.click(screen.getByText('补充营养（选填）'))
    fireEvent.change(screen.getAllByPlaceholderText('可不填')[0], { target: { value: '12' } })
    fireEvent.click(screen.getByText('补充营养（选填）'))
    fireEvent.click(screen.getByText('保存食物'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: '家里卤牛肉', protein: '12', calories: '500', nutritionBasis: '100' }))
  })

  it('keeps package import available and blocks saving during extraction', () => {
    const importPackage = jest.fn()
    const save = jest.fn()
    const view = render(editor({ onImportPackage: importPackage, onSave: save }))
    fireEvent.click(screen.getByText('照片与更多设置'))
    fireEvent.click(screen.getByText('拍包装导入'))
    expect(importPackage).toHaveBeenCalledTimes(1)
    view.rerender(editor({ importing: true, onImportPackage: importPackage, onSave: save }))
    fireEvent.click(screen.getByText('保存食物'))
    expect(save).not.toHaveBeenCalled()
  })

  it('forwards the energy-unit choice without changing numeric values', () => {
    const change = jest.fn()
    render(editor({ value: { ...draft, calories: '418' }, onChange: change }))
    fireEvent.click(screen.getByText('kcal'))
    expect(change).toHaveBeenCalledWith({ energyUnit: 'kcal' })
    expect(screen.getByDisplayValue('418')).toBeInTheDocument()
  })

  it('requires confirmation before reinterpreting existing nutrition in a new unit', async () => {
    const change = jest.fn()
    jest.mocked(Taro.showModal).mockResolvedValueOnce({ confirm: false, cancel: true, errMsg: '' })
    render(editor({ value: { ...draft, calories: '418' }, onChange: change }))
    fireEvent.click(screen.getByText('ml'))
    await waitFor(() => expect(Taro.showModal).toHaveBeenCalled())
    expect(change).not.toHaveBeenCalled()
    jest.mocked(Taro.showModal).mockResolvedValueOnce({ confirm: true, cancel: false, errMsg: '' })
    fireEvent.click(screen.getByText('个'))
    await waitFor(() => expect(change).toHaveBeenCalledWith(expect.objectContaining({ basisUnit: 'piece', portionUnit: 'piece', nutritionBasis: '1', weight: '1', calories: '', unitConversions: {} })))
  })

  it('asks for a relation only when default portion and nutrition basis use different units', () => {
    const view = render(editor({ value: { ...draft, basisUnit: 'ml', portionUnit: 'ml' } }))
    fireEvent.click(screen.getByText('调整'))
    expect(screen.queryByPlaceholderText('填写已知换算关系')).not.toBeInTheDocument()
    view.rerender(editor({ value: { ...draft, basisUnit: 'ml', portionUnit: 'serving', weight: '1' } }))
    expect(screen.getByText('1份相当于多少ml')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('填写已知换算关系')).toBeInTheDocument()
  })

  it.each([['g', '90', '15', '6'], ['ml', '2000', '8', '250']] as const)('defines a user serving from total %s quantity without changing label nutrition', (unit, total, count, perServing) => {
    const save = jest.fn()
    function Harness() {
      const [value, setValue] = useState<CustomFoodEditorDraft>({ ...draft, basisUnit: unit, portionUnit: unit, calories: '500', protein: '8', microValues: { sodium_mg: '10' } })
      return editor({ value, onChange: patch => setValue(previous => ({ ...previous, ...patch })), onSave: () => save(value) })
    }
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByText('调整'))
    fireEvent.click(Array.from(container.querySelectorAll('.custom-editor-portion-settings .custom-basis-chip')).find(element => element.textContent === '份')!)
    fireEvent.click(screen.getByText('按整包计算每份大小'))
    fireEvent.change(screen.getByLabelText(`整包总量${unit}`), { target: { value: total } })
    fireEvent.change(screen.getByLabelText('一包有多少份'), { target: { value: count } })
    expect(screen.getByText(`1份 = ${perServing}${unit}`)).toBeInTheDocument()
    fireEvent.click(screen.getByText('设为默认一份'))
    expect(screen.getByPlaceholderText('填写已知换算关系')).toHaveValue(perServing)
    fireEvent.click(screen.getByText('保存食物'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      weight: '1', portionUnit: 'serving', conversion: perServing, unitConversions: { serving: Number(perServing) },
      basisUnit: unit, nutritionBasis: '100', calories: '500', protein: '8', microValues: { sodium_mg: '10' },
    }))
  })

  it('keeps a known serving relationship when the package count is invalid', () => {
    const change = jest.fn()
    render(editor({ value: { ...draft, basisUnit: 'g', portionUnit: 'serving', weight: '1', conversion: '6', unitConversions: { serving: 6 } }, onChange: change }))
    fireEvent.click(screen.getByText('调整'))
    fireEvent.click(screen.getByText('按整包计算每份大小'))
    fireEvent.change(screen.getByLabelText('整包总量g'), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText('一包有多少份'), { target: { value: '0' } })
    fireEvent.click(screen.getByText('设为默认一份'))
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('填写已知换算关系')).toHaveValue('6')
  })
})
