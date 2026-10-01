import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetStudioPage from '../../src/packagePetStudio/pages/index/index'
import { getPetSummary, getRewardCenter } from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/utils/api', () => ({ getPetSummary: jest.fn(), getRewardCenter: jest.fn() }))
let show: (() => void) | undefined
let hide: (() => void) | undefined
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-01T00:00:00Z'))
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => { show = callback })
  ;(Taro.useDidHide as jest.Mock).mockImplementation(callback => { hide = callback })
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === 'user_id' ? 'test-user' : key.startsWith('home_pet_companion_appearance_v1:') ? { selected: 'original', enabledOriginal: true } : '')
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { id: 'pet', name: '鬼鬼', builtin_avatar_id: 'jianwen-01', selection_candidates: [{ id: 'wheat', name: '小麦', builtin_avatar_id: 'xiaomai-01' }] } })
  ;(getRewardCenter as jest.Mock).mockResolvedValue({ earned_credits_balance: 79 })
})
afterEach(() => { jest.useRealTimers() })
async function mount() {
  const result = render(<PetStudioPage />)
  await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve() })
  return result
}
test('previewing another template does not equip an unsupported scarf or change account appearance', async () => {
  const { container } = await mount()
  fireEvent.click(screen.getByRole('button', { name: '宠物衣橱' }))
  fireEvent.click(screen.getByText('小麦'))
  expect(container.querySelector('.studio-stage .pet-avatar__image')).toHaveAttribute('src', '/assets/pets/xiaomai-01.png')
  expect(screen.getByText('该体型待适配')).toBeInTheDocument()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})
test('scarf preview preserves the original base sprite and only saves dressing on explicit action', async () => {
  const { container } = await mount()
  fireEvent.click(screen.getByRole('button', { name: '宠物衣橱' }))
  fireEvent.click(screen.getByText('暖暖围巾'))
  expect(container.querySelector('.studio-character-scarf')).toBeInTheDocument()
  expect(container.querySelector('.studio-stage .pet-companion-sprite__sheet')).toHaveAttribute('src', '/assets/pets/companions/companion-fbd87f73-v1.png')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('保存搭配'))
  expect(Taro.setStorageSync).toHaveBeenCalledWith(expect.stringContaining('pet_studio_dressing_v1:test-user:'), 'scarf')
})
test('growth is the default playable entry and both adventure actions open the same route', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: /伙伴的冒险时光/ }))
  fireEvent.click(screen.getByText('进入冒险与成长小屋'))
  expect(Taro.navigateTo).toHaveBeenNthCalledWith(1, { url: '/packagePetStudio/pages/adventure/index' })
  expect(Taro.navigateTo).toHaveBeenNthCalledWith(2, { url: '/packagePetStudio/pages/adventure/index' })
  expect(screen.queryByText('开始20秒练习')).not.toBeInTheDocument()
  act(() => { hide?.() })
})

test('kitchen entry opens the full single-player game route', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: '游戏乐园' }))
  fireEvent.click(screen.getByText('宠物餐车'))
  fireEvent.click(screen.getByText('开始餐车关卡'))
  expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packagePetStudio/pages/kitchen/index' })
})

test('an account change cannot save the previous account pet dressing', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: '宠物衣橱' }))
  fireEvent.click(screen.getByText('暖暖围巾'))
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === 'user_id' ? 'another-user' : '')
  await act(async () => { fireEvent.click(screen.getByText('保存搭配')); await Promise.resolve(); await Promise.resolve() })
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(getPetSummary).toHaveBeenCalledTimes(2)
})
