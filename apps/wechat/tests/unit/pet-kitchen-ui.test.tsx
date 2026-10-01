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

test('a player can prepare, cook, plate and serve a full order through the real controls', () => {
  const { container } = render(<PetKitchenGame active accountId='account-one' onExit={jest.fn()} />)
  click(container, 'kitchen-start')
  click(container, 'kitchen-order-order-1')
  click(container, 'kitchen-ingredient-rice')
  click(container, 'kitchen-ingredient-egg')
  click(container, 'kitchen-prepare')
  wait(2000)
  click(container, 'kitchen-prepare')
  wait(4000)
  click(container, 'kitchen-move-cook')
  wait(1500)
  click(container, 'kitchen-serve')
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
