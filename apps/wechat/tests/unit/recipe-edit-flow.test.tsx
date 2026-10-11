import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import RecipeEditPage from '../../src/packageExtra/pages/recipe-edit/index'
import { getUserRecipe, updateUserRecipe, deleteUserRecipe, showUnifiedApiError, type UserRecipe } from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/utils/api', () => ({
  getUserRecipe: jest.fn(), updateUserRecipe: jest.fn(), deleteUserRecipe: jest.fn(), showUnifiedApiError: jest.fn()
}))
jest.mock('@tarojs/components', () => {
  const React = require('react')
  const field = (tag: string) => ({ onInput, ...props }: any) => React.createElement(tag, {
    ...props, onChange: (event: any) => onInput({ detail: { value: event.target.value } })
  })
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Button: ({ children, loading, ...props }: any) => React.createElement('button', props, children),
    Input: field('input'), Textarea: field('textarea')
  }
})

const recipe = {
  id: 'recipe-test', user_id: 'test-user', recipe_name: '午餐', description: '原描述',
  meal_type: 'lunch', total_calories: 420, total_protein: 25, total_carbs: 50, total_fat: 12,
  tags: ['常吃'], items: [{ name: '米饭', weight_grams: 100 }], is_favorite: true
} as unknown as UserRecipe

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: { id: recipe.id } })
  ;(getUserRecipe as jest.Mock).mockResolvedValue(recipe)
  ;(updateUserRecipe as jest.Mock).mockResolvedValue({ recipe })
  ;(deleteUserRecipe as jest.Mock).mockResolvedValue({ message: 'ok' })
  ;(showUnifiedApiError as jest.Mock).mockResolvedValue(undefined)
  ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true })
})
afterEach(() => jest.useRealTimers())
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
async function mount() { const view = render(<RecipeEditPage />); await flush(); return view }
function editName(value: string) { fireEvent.change(screen.getByPlaceholderText('请输入食谱名称'), { target: { value } }) }
function successToasts() { return (Taro.showToast as jest.Mock).mock.calls.filter(([options]) => options.icon === 'success') }

test('loads the recipe and updates only editable metadata after a confirmed response', async () => {
  await mount()
  expect(getUserRecipe).toHaveBeenCalledWith(recipe.id)
  expect(screen.getByDisplayValue('午餐')).toBeInTheDocument()
  expect(screen.getByText('420')).toBeInTheDocument()
  editName('  晚饭  ')
  fireEvent.click(screen.getByText('晚餐'))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await flush()
  expect(updateUserRecipe).toHaveBeenCalledWith(recipe.id, { recipe_name: '晚饭', description: '原描述', meal_type: 'dinner' })
  expect(successToasts()).toHaveLength(1)
  expect(Taro.navigateBack).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(1500))
  expect(Taro.navigateBack).toHaveBeenCalledTimes(1)
})

test('pending save blocks duplicates; failed save retains the draft and permits retry', async () => {
  let reject!: (error: Error) => void
  ;(updateUserRecipe as jest.Mock).mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
  await mount()
  editName('我的草稿')
  const save = screen.getByRole('button', { name: '保存' })
  fireEvent.click(save); fireEvent.click(save)
  expect(updateUserRecipe).toHaveBeenCalledTimes(1)
  expect(save).toBeDisabled()
  await act(async () => { reject(new Error('offline')); await Promise.resolve() })
  expect(screen.getByDisplayValue('我的草稿')).toBeInTheDocument()
  expect(save).toBeEnabled()
  expect(successToasts()).toHaveLength(0)
  expect(Taro.navigateBack).not.toHaveBeenCalled()
  fireEvent.click(save); await flush()
  expect(updateUserRecipe).toHaveBeenCalledTimes(2)
})

test('empty names do not submit', async () => {
  await mount(); editName('   ')
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(updateUserRecipe).not.toHaveBeenCalled()
  expect(Taro.showToast).toHaveBeenCalledWith({ title: '请输入食谱名称', icon: 'none' })
})

test('cancelled deletion leaves the recipe intact and unlocks actions', async () => {
  ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: false })
  await mount(); fireEvent.click(screen.getByRole('button', { name: '删除食谱' })); await flush()
  expect(deleteUserRecipe).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  expect(successToasts()).toHaveLength(0)
})

test('confirmed deletion waits for the API and prevents duplicate modal requests', async () => {
  let resolve!: () => void
  ;(deleteUserRecipe as jest.Mock).mockReturnValueOnce(new Promise<void>(done => { resolve = done }))
  await mount()
  const button = screen.getByRole('button', { name: '删除食谱' })
  fireEvent.click(button); fireEvent.click(button); await flush()
  expect(Taro.showModal).toHaveBeenCalledTimes(1)
  expect(deleteUserRecipe).toHaveBeenCalledWith(recipe.id)
  expect(successToasts()).toHaveLength(0)
  await act(async () => { resolve(); await Promise.resolve() })
  expect(successToasts()).toHaveLength(1)
  act(() => jest.advanceTimersByTime(1500))
  expect(Taro.navigateBack).toHaveBeenCalledTimes(1)
})

test('failed deletion never displays success or returns; the form remains usable', async () => {
  ;(deleteUserRecipe as jest.Mock).mockRejectedValueOnce(new Error('offline'))
  await mount(); fireEvent.click(screen.getByRole('button', { name: '删除食谱' })); await flush()
  expect(showUnifiedApiError).toHaveBeenCalledWith(expect.any(Error), '删除失败')
  expect(successToasts()).toHaveLength(0)
  expect(Taro.navigateBack).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
})

test('failed detail load cannot save blank values and offers retry', async () => {
  ;(getUserRecipe as jest.Mock).mockRejectedValueOnce(new Error('offline'))
  await mount()
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试' })); await flush()
  expect(screen.getByDisplayValue('午餐')).toBeInTheDocument()
})

test('missing id never reads, saves or deletes a recipe', async () => {
  ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: {} })
  await mount()
  expect(getUserRecipe).not.toHaveBeenCalled()
  expect(updateUserRecipe).not.toHaveBeenCalled()
  expect(deleteUserRecipe).not.toHaveBeenCalled()
  expect(screen.getByText('无法编辑食谱')).toBeInTheDocument()
})
