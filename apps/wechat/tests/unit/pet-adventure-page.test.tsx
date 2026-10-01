import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetAdventurePage from '../../src/packagePetStudio/pages/adventure/index'
import { getPetSummary } from '../../src/utils/api'
import { createAdventureProgress } from '../../src/utils/pet-adventure-progress'
import type { AdventureResult } from '../../src/utils/pet-adventure-game'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/utils/api', () => ({ getPetSummary: jest.fn() }))
let mockRound = 0
let mockLastFinish: (() => void) | undefined
jest.mock('../../src/packagePetStudio/components/PetAdventureGame', () => ({
  PetAdventureGame: (props: any) => <div>
    <button onClick={() => {
      mockRound += 1
      const result: AdventureResult = { levelId: props.startLevel, completed: true, score: 800, stars: 3, leaves: 30, collectedStars: 12, hearts: 3, distance: 270, elapsedMs: 45000, experience: 58 }
      const id = `test-round-${mockRound}`
      mockLastFinish = () => props.onFinished(result, id, props.accountId)
      mockLastFinish()
    }}
    >完成真实结果回调</button>
    <button onClick={() => mockLastFinish?.()}>重复结果回调</button>
    <button onClick={props.onRetrySettlement} disabled={!props.onRetrySettlement}>重试保存</button>
    <button onClick={props.onExit}>回小屋</button>
    <span>{props.settlementText}</span>
  </div>,
}))
let show: (() => void) | undefined
let hide: (() => void) | undefined
let storage: Map<string, unknown>
const key = 'pet_adventure_progress_v1:test-user:pet'
beforeEach(() => {
  jest.clearAllMocks(); mockRound = 0; mockLastFinish = undefined
  storage = new Map<string, unknown>([['user_id', 'test-user'], ['home_pet_companion_appearance_v1:test-user', { selected: 'original', enabledOriginal: true }]])
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => { show = callback })
  ;(Taro.useDidHide as jest.Mock).mockImplementation(callback => { hide = callback })
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(name => storage.get(name) || '')
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((name, value) => storage.set(name, value))
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { id: 'pet', name: '鬼鬼', builtin_avatar_id: 'jianwen-01' } })
})
async function mount() {
  const view = render(<PetAdventurePage />)
  await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve() })
  return view
}
function clickId(container: HTMLElement, id: string) {
  fireEvent.click(container.querySelector(`#${id}`)!)
}

test('settled adventure unlocks travel and story; earned stars buy and place a persistent collectible exactly once', async () => {
  const { container, unmount } = await mount()
  clickId(container, 'growth-level-1')
  fireEvent.click(screen.getByText('完成真实结果回调'))
  fireEvent.click(screen.getByText('重复结果回调'))
  expect((storage.get(key) as any).starBalance).toBe(15)
  fireEvent.click(screen.getByText('完成真实结果回调'))
  expect((storage.get(key) as any).starBalance).toBe(30)
  fireEvent.click(screen.getByText('回小屋'))
  expect(container.querySelector('#growth-level-2')).not.toBeDisabled()
  clickId(container, 'growth-tab-collection')
  clickId(container, 'growth-item-plant')
  expect((storage.get(key) as any).starBalance).toBe(10)
  clickId(container, 'growth-item-plant')
  expect((storage.get(key) as any).placements.left).toBe('plant')
  expect((storage.get(key) as any).inventory).toEqual(['plant'])
  clickId(container, 'growth-tab-story')
  expect(screen.getByText(/窗外的树叶轻轻摇晃/)).toBeInTheDocument()
  unmount()
  const reopened = await mount()
  expect(reopened.container.querySelector('#growth-place-left .growth-sprite')).toBeInTheDocument()
  expect(reopened.container.querySelector('.growth-balance')).toHaveTextContent('10')
})

test('storage failure does not show rewards and the same round can be saved once after retry', async () => {
  const { container } = await mount()
  clickId(container, 'growth-level-1')
  ;(Taro.setStorageSync as jest.Mock).mockImplementationOnce(() => { throw new Error('disk full') })
  fireEvent.click(screen.getByText('完成真实结果回调'))
  expect(storage.has(key)).toBe(false)
  expect(screen.getByText('收获尚未保存，重试后再离开')).toBeInTheDocument()
  fireEvent.click(screen.getByText('回小屋'))
  expect(screen.getByText('重试保存')).toBeEnabled()
  fireEvent.click(screen.getByText('重试保存'))
  fireEvent.click(screen.getByText('重复结果回调'))
  expect((storage.get(key) as any).starBalance).toBe(15)
  expect((storage.get(key) as any).settledRoundIds).toEqual(['test-round-1'])
})

test('collection read failure cannot overwrite a previously saved balance with a fresh empty save', async () => {
  const saved = { ...createAdventureProgress(), starBalance: 40 }
  storage.set(key, saved)
  const { container } = await mount()
  clickId(container, 'growth-tab-collection')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(name => { if (name === key) throw new Error('storage busy'); return storage.get(name) || '' })
  clickId(container, 'growth-item-plant')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(storage.get(key)).toBe(saved)
  expect(container.querySelector('.growth-balance')).toHaveTextContent('40')
})

test('a hidden page or switched account cannot settle the previous pet round', async () => {
  const { container } = await mount()
  clickId(container, 'growth-level-1')
  act(() => { hide?.() })
  fireEvent.click(screen.getByText('完成真实结果回调'))
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  storage.set('user_id', 'other-user')
  fireEvent.click(screen.getByText('重复结果回调'))
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('a finish arriving during hide is retained for saving when the same account returns', async () => {
  const { container } = await mount()
  clickId(container, 'growth-level-1')
  act(() => { hide?.() })
  fireEvent.click(screen.getByText('完成真实结果回调'))
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  act(() => { show?.() })
  fireEvent.click(screen.getByText('重试保存'))
  expect((storage.get(key) as any).starBalance).toBe(15)
  expect((storage.get(key) as any).settledRoundIds).toEqual(['test-round-1'])
})

test('an old account summary cannot render a pet after the stored account changes', async () => {
  let resolve: (value: unknown) => void = () => undefined
  ;(getPetSummary as jest.Mock).mockImplementation(() => new Promise(done => { resolve = done }))
  render(<PetAdventurePage />)
  act(() => { show?.() })
  storage.set('user_id', 'other-user')
  await act(async () => { resolve({ pet: { id: 'old-pet', name: '旧伙伴' } }); await Promise.resolve() })
  expect(screen.queryByText('旧伙伴的小屋')).not.toBeInTheDocument()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('identity storage failure retains the result for verified retry and initial failure offers retry', async () => {
  const { container, unmount } = await mount()
  clickId(container, 'growth-level-1')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(() => { throw new Error('storage unavailable') })
  fireEvent.click(screen.getByText('完成真实结果回调'))
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(screen.getByText('重试保存')).toBeEnabled()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(name => storage.get(name) || '')
  fireEvent.click(screen.getByText('重试保存'))
  expect((storage.get(key) as any).starBalance).toBe(15)
  unmount()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(() => { throw new Error('storage unavailable') })
  await mount()
  expect(screen.getByText('重新尝试')).toBeInTheDocument()
})
