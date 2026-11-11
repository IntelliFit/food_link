import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import type { ManualFoodSearchResult } from '../../src/utils/api'
import { ManualFoodCard } from '../../src/packageExtra/pages/record-manual/ManualFoodCard'
import { ManualFoodDetailSheet } from '../../src/packageExtra/pages/record-manual/ManualFoodDetailSheet'
import { manualFoodDetailNutrition, manualFoodNutritionBasis } from '../../src/packageExtra/pages/record-manual/manual-food-detail'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Image: ({ mode: _mode, ...props }: any) => React.createElement('img', props),
    ScrollView: ({ children, scrollY: _scrollY, ...props }: any) => React.createElement('div', props, children),
    PageContainer: ({ show, onBeforeLeave, children }: any) => show ? React.createElement('div', {},
      React.createElement('button', { onClick: onBeforeLeave }, '模拟系统返回'), children) : null,
  }
})

const food: ManualFoodSearchResult = {
  id: 'custom-1', source: 'custom', can_edit: true, title: '自制奶酪', subtitle: '',
  default_weight_grams: 50, display_unit: 'g', display_unit_label: 'g',
  total_calories: 150, total_protein: 10, total_carbs: 5, total_fat: 10,
  nutrients_per_100g: { calories: 300, protein: 20, carbs: 10, fat: 20, fiber: 2, sugar: 0, sodium_mg: 400 },
  image_paths: ['https://example.com/front.jpg', 'https://example.com/nutrition.jpg'],
}

function FoodLibraryHarness({ item = food, onAdd = jest.fn(), onManage = jest.fn() }: {
  item?: ManualFoodSearchResult; onAdd?: jest.Mock; onManage?: jest.Mock
}) {
  const [detail, setDetail] = useState<ManualFoodSearchResult | null>(null)
  return <>
    <ManualFoodCard item={item} onView={() => setDetail(item)} onAdd={onAdd} onManage={onManage} />
    <ManualFoodDetailSheet item={detail} onClose={() => setDetail(null)} onAdd={onAdd} />
  </>
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(Taro as any).canIUse = jest.fn(() => false)
  ;(Taro as any).previewImage = jest.fn()
})

it.each(['custom', 'packaged_food', 'nutrition_library', 'public_library'] as const)('opens %s details without requesting a different library', (source) => {
  render(<FoodLibraryHarness item={{ ...food, source }} />)
  fireEvent.click(screen.getByLabelText(`查看${food.title}详情`))
  expect(screen.getByText('食物详情')).toBeInTheDocument()
  expect(screen.getByText('加入本餐')).toBeInTheDocument()
  expect(Taro.request).not.toHaveBeenCalled()
  expect(Taro.navigateTo).not.toHaveBeenCalled()
})

it('keeps add and creator edit separate from opening details', () => {
  const onAdd = jest.fn()
  const onManage = jest.fn()
  render(<FoodLibraryHarness onAdd={onAdd} onManage={onManage} />)
  fireEvent.click(screen.getByLabelText(`添加${food.title}到本餐`))
  expect(onAdd).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('食物详情')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('编辑'))
  expect(onManage).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('食物详情')).not.toBeInTheDocument()
})

it('allows adding from details once and removes details on close', () => {
  const onAdd = jest.fn()
  render(<FoodLibraryHarness onAdd={onAdd} />)
  fireEvent.click(screen.getByLabelText(`查看${food.title}详情`))
  fireEvent.click(screen.getByText('加入本餐'))
  expect(onAdd).toHaveBeenCalledTimes(1)
  expect(onAdd).toHaveBeenCalledWith(food)
  expect(screen.queryByText('食物详情')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText(`查看${food.title}详情`))
  fireEvent.click(screen.getByText('关闭'))
  expect(screen.queryByText('食物详情')).not.toBeInTheDocument()
})

it('hides editing for another user contribution and previews all valid images', () => {
  render(<FoodLibraryHarness item={{ ...food, can_edit: false, source_label: '用户贡献' }} />)
  expect(screen.queryByText('编辑')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText(`查看${food.title}详情`))
  const images = screen.getAllByRole('img')
  fireEvent.click(images[images.length - 1])
  expect(Taro.previewImage).toHaveBeenCalledWith({ current: food.image_paths![0], urls: food.image_paths })
})

it('closes the native page container when the system back action fires', () => {
  ;(Taro as any).canIUse.mockReturnValue(true)
  render(<FoodLibraryHarness />)
  fireEvent.click(screen.getByLabelText(`查看${food.title}详情`))
  fireEvent.click(screen.getByText('模拟系统返回'))
  expect(screen.queryByText('食物详情')).not.toBeInTheDocument()
})

it('preserves an explicit 100ml basis instead of labeling it as grams', () => {
  const milk = { ...food, source: 'packaged_food' as const, display_unit: 'ml' as const, display_unit_label: 'ml', title: '牛奶', subtitle: '营养口径 100ml', default_weight_grams: 250 }
  render(<FoodLibraryHarness item={milk} />)
  fireEvent.click(screen.getByLabelText('查看牛奶详情'))
  expect(screen.getByText('每100ml')).toBeInTheDocument()
  expect(screen.queryByText('每100g')).not.toBeInTheDocument()
  expect(manualFoodNutritionBasis({ ...milk, subtitle: '' })).toBeNull()
})

it('shows a native per-piece basis and scales the default quantity', () => {
  const pieceFood = { ...food, default_weight_grams: 0, measurement: { amount: 2, unit: 'piece' as const, basis_amount: 1, basis_unit: 'piece' as const, nutrients_per_basis: { calories: 80, protein: 5 } } }
  render(<FoodLibraryHarness item={pieceFood} />)
  fireEvent.click(screen.getByLabelText(`查看${food.title}详情`))
  expect(screen.getByText('2个')).toBeInTheDocument()
  expect(screen.getByText('160')).toBeInTheDocument()
  fireEvent.click(screen.getByText('每1个'))
  expect(screen.getByText('80')).toBeInTheDocument()
  expect(screen.queryByText('每100g')).not.toBeInTheDocument()
})

it('scales known custom micronutrients for a default portion and omits missing values', () => {
  const nutrition = manualFoodDetailNutrition(food)
  expect(nutrition.microRows).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: '钠', value: '200', unit: 'mg' }),
    expect.objectContaining({ label: '膳食纤维', value: '1', unit: 'g' }),
  ]))
  expect(nutrition.microRows.some((row) => row.label === '铁' || row.label === '糖')).toBe(false)
  expect(manualFoodDetailNutrition({ ...food, display_unit: 'ml' }).microRows).toHaveLength(0)
})

it('starts each newly opened food at its default portion instead of retaining the previous tab', () => {
  render(<FoodLibraryHarness />)
  fireEvent.click(screen.getByLabelText(`查看${food.title}详情`))
  fireEvent.click(screen.getByText('每100g'))
  expect(screen.getByText('300')).toBeInTheDocument()
  fireEvent.click(screen.getByText('关闭'))
  fireEvent.click(screen.getByLabelText(`查看${food.title}详情`))
  expect(screen.getByText('150')).toBeInTheDocument()
  expect(screen.queryByText('300')).not.toBeInTheDocument()
})
