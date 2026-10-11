import { act, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import RecipeDetailPage from '../../src/packageExtra/pages/recipe-detail/index'
import { getUserRecipe } from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/utils/api', () => ({ getUserRecipe: jest.fn(), showUnifiedApiError: jest.fn() }))
jest.mock('../../src/utils/home-dashboard-local-cache', () => ({}))

test('returning from editing rereads the saved recipe instead of displaying stale details', async () => {
  let show!: () => void
  jest.clearAllMocks()
  ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: { id: 'recipe-test' } })
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => { show = callback })
  ;(Taro.getStorageSync as jest.Mock).mockReturnValue('test-user')
  const original = { id: 'recipe-test', user_id: 'test-user', recipe_name: '原名称', items: [], total_calories: 420, total_protein: 25, total_carbs: 50, total_fat: 12 }
  ;(getUserRecipe as jest.Mock).mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, recipe_name: '已保存的新名称' })
  render(<RecipeDetailPage />)
  await act(async () => { show(); await Promise.resolve() })
  expect(screen.getByText('原名称')).toBeInTheDocument()
  await act(async () => { show(); await Promise.resolve() })
  expect(screen.getByText('已保存的新名称')).toBeInTheDocument()
  expect(screen.queryByText('原名称')).not.toBeInTheDocument()
  expect(getUserRecipe).toHaveBeenCalledTimes(2)
})
