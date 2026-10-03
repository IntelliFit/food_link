import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { PetKitchenGame } from '../../src/packagePetStudio/components/PetKitchenGame'

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-10-01T00:00:00Z'))
  ;(Taro.getStorageSync as jest.Mock).mockReturnValue('')
})
afterEach(() => { jest.useRealTimers() })

function click(container: HTMLElement, id: string) {
  const element = container.querySelector(`#${id}`)
  expect(element).not.toBeNull()
  fireEvent.click(element as Element)
}
function wait(milliseconds: number) { act(() => { jest.advanceTimersByTime(milliseconds) }) }

test('two taps prepare and deliver a real order, leaving the timing decision to the player', () => {
  const { container } = render(<PetKitchenGame active accountId='account-one' onExit={jest.fn()} />)
  click(container, 'kitchen-start')
  click(container, 'kitchen-order-order-1')
  expect(container.querySelector('#kitchen-order-order-1')).toBeDisabled()
  expect(container.querySelector('#kitchen-prepare')).toBeNull()
  expect(container.querySelector('#kitchen-heat-high')).toBeNull()
  expect(container.querySelector('#kitchen-ingredient-rice')).toBeNull()
  wait(6000)
  click(container, 'kitchen-move-cook')
  wait(1500)
  expect(container.querySelector('#kitchen-serve')).toBeNull()
  expect(screen.getByText(/递餐成功 \+120分/)).toBeInTheDocument()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('backgrounding pauses the round and requires an explicit resume without consuming hidden time', () => {
  const { container, rerender } = render(<PetKitchenGame active accountId='account-one' onExit={jest.fn()} />)
  click(container, 'kitchen-start')
  wait(2000)
  const before = container.querySelector('.pet-kitchen__hud')?.textContent
  rerender(<PetKitchenGame active={false} accountId='account-one' onExit={jest.fn()} />)
  wait(5000)
  expect(container.querySelector('.pet-kitchen__hud')?.textContent).toBe(before)
  expect(screen.getByText('餐车歇一会儿')).toBeInTheDocument()
  expect(container.querySelector('#kitchen-resume')).toBeDisabled()
  rerender(<PetKitchenGame active accountId='account-one' onExit={jest.fn()} />)
  expect(screen.getByText('餐车歇一会儿')).toBeInTheDocument()
  click(container, 'kitchen-resume')
  wait(1000)
  expect(container.querySelector('.pet-kitchen__hud')?.textContent).not.toBe(before)
})

test('a completed round saves only an account-local record once and has replay controls', () => {
  const { container } = render(<PetKitchenGame active accountId='account-one' onExit={jest.fn()} />)
  click(container, 'kitchen-start')
  wait(90000)
  expect(screen.getByText('今日营业结束')).toBeInTheDocument()
  expect(Taro.setStorageSync).toHaveBeenCalledTimes(1)
  expect(Taro.setStorageSync).toHaveBeenCalledWith('pet_kitchen_best_v1:account-one', expect.objectContaining({ version: 1 }))
  wait(5000)
  expect(Taro.setStorageSync).toHaveBeenCalledTimes(1)
  click(container, 'kitchen-retry')
  expect(container.querySelector('#kitchen-pause')).toBeInTheDocument()
})

test('switching accounts clears the current round instead of carrying progress into the new account', () => {
  const { container, rerender } = render(<PetKitchenGame active accountId='account-one' onExit={jest.fn()} />)
  click(container, 'kitchen-start')
  wait(1000)
  rerender(<PetKitchenGame active accountId='account-two' onExit={jest.fn()} />)
  expect(container.querySelector('#kitchen-start')).toBeInTheDocument()
  expect(container.querySelector('#kitchen-pause')).not.toBeInTheDocument()
  wait(90000)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('one picnic order tap prepares the matching pair without a separate batch or shelf control', () => {
  const { container } = render(<PetKitchenGame active accountId='account-one' onExit={jest.fn()} />)
  click(container, 'kitchen-level-3'); click(container, 'kitchen-start')
  click(container, 'kitchen-order-order-1')
  expect(container.querySelector('#kitchen-order-order-2')).toBeDisabled()
  wait(2500)
  expect(screen.getByText('1份等入锅')).toBeInTheDocument()
  expect(container.querySelector('#kitchen-prepare-batch')).toBeNull()
  expect(container.querySelector('#kitchen-move-cook')).toBeDisabled()
  wait(4500)
  click(container, 'kitchen-move-cook')
  wait(1800)
  expect(screen.getByText(/递餐成功 \+180分/)).toBeInTheDocument()
})

test('terminal callback captures original scope and callback once without losing standalone best scores', async () => {
  const first = jest.fn(); const replacement = jest.fn()
  const { container, rerender } = render(<PetKitchenGame active accountId='account:pet-one' onFinished={first} onExit={jest.fn()} />)
  click(container, 'kitchen-start')
  rerender(<PetKitchenGame active accountId='account:pet-one' onFinished={replacement} onExit={jest.fn()} />)
  await act(async () => { jest.advanceTimersByTime(90000); await Promise.resolve(); await Promise.resolve() })
  expect(first).toHaveBeenCalledTimes(1)
  expect(first).toHaveBeenCalledWith(expect.objectContaining({ levelId: 1, passed: false, collectibleIds: [] }), expect.stringMatching(/^kitchen:/), 'account:pet-one')
  expect(replacement).not.toHaveBeenCalled()
  expect(Taro.setStorageSync).toHaveBeenCalledWith('pet_kitchen_best_v1:account:pet-one', expect.anything())
  wait(5000); expect(first).toHaveBeenCalledTimes(1)
})

test('failed shared settlement locks retry and exit until the same round is saved successfully', async () => {
  const callback = jest.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
  const { container } = render(<PetKitchenGame active accountId='account:pet-one' onFinished={callback} onExit={jest.fn()} />)
  click(container, 'kitchen-start')
  await act(async () => { jest.advanceTimersByTime(90000); await Promise.resolve(); await Promise.resolve() })
  expect(container.querySelector('#kitchen-retry')).toBeDisabled()
  expect(container.querySelector('#kitchen-back')).toBeDisabled()
  const oldCall = callback.mock.calls[0]
  await act(async () => { click(container, 'kitchen-retry-settlement'); await Promise.resolve(); await Promise.resolve() })
  expect(callback.mock.calls[1]).toEqual(oldCall)
  expect(container.querySelector('#kitchen-retry')).not.toBeDisabled()
})

test('parent-reported unsaved status retains the finished round even if callback succeeds locally', async () => {
  const retry = jest.fn()
  const { container } = render(<PetKitchenGame active accountId='account:pet-one' onFinished={jest.fn()} onRetrySettlement={retry} settlementText='还未保存' onExit={jest.fn()} />)
  click(container, 'kitchen-start')
  await act(async () => { jest.advanceTimersByTime(90000); await Promise.resolve(); await Promise.resolve() })
  expect(container.querySelector('#kitchen-retry')).toBeDisabled()
  expect(container.querySelector('#kitchen-back')).toBeDisabled()
  expect(screen.getByText('还未保存')).toBeInTheDocument()
  await act(async () => { click(container, 'kitchen-retry-settlement'); await Promise.resolve(); await Promise.resolve() })
  expect(retry).toHaveBeenCalledTimes(1)
})

test('legacy account scores remain a labelled reference without being attributed to a new pet or rewarded', () => {
  const legacy = { version: 1, levels: { '1': { score: 900, stars: 3, served: 8 } } }
  const store = new Map<string, unknown>([['user_id', 'user-a'], ['pet_kitchen_best_v1:user-a', legacy]])
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => store.get(key))
  const onFinished = jest.fn()
  const { container } = render(<PetKitchenGame active accountId='user-a:new-pet' onFinished={onFinished} onExit={jest.fn()} />)
  expect(container.querySelector('#kitchen-account-history')).toHaveTextContent('账号历史最好（参考） · 900分')
  expect(container.querySelector('#kitchen-level-1')).not.toHaveTextContent('最佳 900分')
  expect(container.querySelector('#kitchen-level-1 .pet-kitchen__stars')).toHaveTextContent('☆☆☆')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(onFinished).not.toHaveBeenCalled()
  expect(store.get('pet_kitchen_best_v1:user-a')).toEqual(legacy)
})

test('changing pets loads the exact scope and never copies higher account history into the new pet score', () => {
  const legacy = { version: 1, levels: { '1': { score: 900, stars: 3, served: 8 } } }
  const bestA = { version: 1, levels: { '1': { score: 300, stars: 1, served: 2 } } }
  const bestB = { version: 1, levels: { '1': { score: 550, stars: 2, served: 4 } } }
  const store = new Map<string, unknown>([['user_id', 'user-a'], ['pet_kitchen_best_v1:user-a', legacy], ['pet_kitchen_best_v1:user-a:pet-a', bestA], ['pet_kitchen_best_v1:user-a:pet-b', bestB]])
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => store.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => store.set(key, value))
  const { container, rerender } = render(<PetKitchenGame active accountId='user-a:pet-a' onExit={jest.fn()} />)
  expect(container.querySelector('#kitchen-level-1')).toHaveTextContent('最佳 300分')
  click(container, 'kitchen-start'); wait(1000)
  rerender(<PetKitchenGame active accountId='user-a:pet-b' onExit={jest.fn()} />)
  expect(container.querySelector('#kitchen-level-1')).toHaveTextContent('最佳 550分')
  expect(container.querySelector('#kitchen-account-history')).toHaveTextContent('900分')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  click(container, 'kitchen-start'); wait(90000)
  expect(store.get('pet_kitchen_best_v1:user-a:pet-b')).toEqual(bestB)
  expect(store.get('pet_kitchen_best_v1:user-a:pet-a')).toEqual(bestA)
  expect(store.get('pet_kitchen_best_v1:user-a')).toEqual(legacy)
  fireEvent.click(screen.getByRole('button', { name: '返回关卡地图' }))
  expect(container.querySelector('#kitchen-account-history')).toHaveTextContent('900分')
})

test('account reference takes the higher valid score without exposing a previous account after switching', () => {
  const store = new Map<string, unknown>([
    ['user_id', 'user-a'], ['pet_kitchen_best_v1:user-a', { version: 1, levels: { '1': { score: 900, stars: 3, served: 8 } } }],
    ['pet_kitchen_best_v1:user-a:pet-a', { version: 1, levels: { '1': { score: 1200, stars: 3, served: 9 } } }],
    ['pet_kitchen_best_v1:user-b', { version: 1, levels: { '1': { score: 180, stars: 1, served: 2 } } }],
  ])
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => store.get(key))
  const { container, rerender } = render(<PetKitchenGame active accountId='user-a:pet-a' onExit={jest.fn()} />)
  expect(container.querySelector('#kitchen-account-history')).toHaveTextContent('1200分')
  store.set('user_id', 'user-b')
  rerender(<PetKitchenGame active accountId='user-b:pet-a' onExit={jest.fn()} />)
  expect(container.querySelector('#kitchen-account-history')).toHaveTextContent('180分')
  expect(container.querySelector('#kitchen-level-1')).not.toHaveTextContent('1200分')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('malformed legacy scores are ignored without deleting their recovery source', () => {
  const legacy = { version: 1, levels: { '1': { score: 900, stars: 4, served: 8 }, '2': { score: 700, stars: 2, served: -1 } } }
  const store = new Map<string, unknown>([['user_id', 'user-a'], ['pet_kitchen_best_v1:user-a', legacy]])
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => store.get(key))
  const { container } = render(<PetKitchenGame active accountId='user-a:pet-a' onExit={jest.fn()} />)
  expect(container.querySelector('#kitchen-account-history')).not.toBeInTheDocument()
  click(container, 'kitchen-level-2')
  expect(container.querySelector('#kitchen-account-history')).not.toBeInTheDocument()
  expect(store.get('pet_kitchen_best_v1:user-a')).toEqual(legacy)
  expect(Taro.removeStorageSync).not.toHaveBeenCalled()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('a temporary best-score read failure cannot replace the original high score with an empty new record', () => {
  const stored = { version: 1, levels: { '1': { score: 900, stars: 3, served: 8 } } }
  let unavailable = false
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => {
    if (key === 'pet_kitchen_best_v1:user-a:pet-a') {
      if (unavailable) throw new Error('storage read unavailable')
      return stored
    }
    return key === 'user_id' ? 'user-a' : undefined
  })
  const { container } = render(<PetKitchenGame active accountId='user-a:pet-a' onExit={jest.fn()} />)
  click(container, 'kitchen-start')
  unavailable = true
  wait(90000)
  expect(screen.getByText('今日营业结束')).toBeInTheDocument()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(Taro.removeStorageSync).not.toHaveBeenCalled()
})
