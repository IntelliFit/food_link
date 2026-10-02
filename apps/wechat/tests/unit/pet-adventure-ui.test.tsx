import { act, fireEvent, render, screen } from '@testing-library/react'
import { PetAdventureGame } from '../../src/packagePetStudio/components/PetAdventureGame'
import type { PetProfile } from '../../src/utils/api'

jest.mock('../../src/components/PetActor', () => ({
  PetActor: ({ pet, action, active }: { pet?: { name: string }; action: string; active: boolean }) => <span data-testid='current-pet' data-action={action} data-active={active}>{pet?.name}</span>,
}))
const pet = { id: 'original-pet', name: '鬼鬼' } as PetProfile
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-02T00:00:00Z')) })
afterEach(() => jest.useRealTimers())
function click(container: HTMLElement, id: string) {
  const element = container.querySelector(`#${id}`)
  expect(element).not.toBeNull()
  fireEvent.click(element as Element)
}
function world(container: HTMLElement) { return container.querySelector('#adventure-world') as HTMLElement }
function wait(milliseconds: number) { act(() => { jest.advanceTimersByTime(milliseconds) }) }
function x(container: HTMLElement) { return Number(world(container).getAttribute('data-x')) }
function getToMechanism(container: HTMLElement, route = 'safe') {
  wait(4300)
  expect(world(container)).toHaveAttribute('data-phase', 'fork')
  click(container, `adventure-route-${route}`)
  wait(5100)
  expect(world(container)).toHaveAttribute('data-phase', 'mechanism')
}
function clearRoot(container: HTMLElement) {
  click(container, 'adventure-right')
  click(container, 'adventure-jump')
  for (let step = 0; step < 5; step++) click(container, 'adventure-right')
  expect(world(container)).toHaveAttribute('data-phase', 'travel')
  wait(4200)
}
async function finishThreeScenes(container: HTMLElement) {
  for (let index = 0; index < 3; index++) {
    getToMechanism(container)
    clearRoot(container)
    if (index < 2) { expect(world(container)).toHaveAttribute('data-phase', 'rest'); click(container, 'adventure-continue') }
  }
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function timeoutRound() { await act(async () => { jest.advanceTimersByTime(90000); await Promise.resolve(); await Promise.resolve() }) }

test('fork choices and jump plus forward solve a real scene with the currently selected actor', () => {
  const { container } = render(<PetAdventureGame active pet={pet} accountId='account:original-pet' onExit={jest.fn()} />)
  expect(screen.getByTestId('current-pet')).toHaveTextContent('鬼鬼')
  click(container, 'adventure-start')
  expect(container.querySelector('#adventure-right')).toBeDisabled()
  getToMechanism(container, 'collectible')
  expect(world(container)).toHaveAttribute('data-route', 'collectible')
  fireEvent.touchStart(world(container), { touches: [{ clientX: 100, clientY: 100 }] })
  fireEvent.touchEnd(world(container), { changedTouches: [{ clientX: 160, clientY: 100 }] })
  expect(x(container)).toBe(59)
  click(container, 'adventure-jump')
  expect(Number(world(container).getAttribute('data-jump'))).toBeGreaterThan(0)
  expect(container.querySelector('#adventure-jump')).toBeDisabled()
  for (let index = 0; index < 5; index++) click(container, 'adventure-right')
  expect(world(container)).toHaveAttribute('data-phase', 'travel')
  expect(Number(world(container).getAttribute('data-score'))).toBeGreaterThan(50)
  expect(screen.getByText(/背包 1件/)).toBeInTheDocument()
})

test('backgrounding freezes the trip and actor; returning requires an explicit resume', () => {
  const { container, rerender } = render(<PetAdventureGame active pet={pet} accountId='account:original-pet' onExit={jest.fn()} />)
  click(container, 'adventure-start'); wait(500)
  const distance = world(container).getAttribute('data-distance')
  rerender(<PetAdventureGame active={false} pet={pet} accountId='account:original-pet' onExit={jest.fn()} />)
  wait(5000)
  expect(world(container)).toHaveAttribute('data-state', 'paused')
  expect(world(container)).toHaveAttribute('data-distance', distance)
  expect(screen.getByTestId('current-pet')).toHaveAttribute('data-active', 'false')
  expect(container.querySelector('#adventure-resume')).toBeDisabled()
  rerender(<PetAdventureGame active pet={pet} accountId='account:original-pet' onExit={jest.fn()} />)
  expect(world(container)).toHaveAttribute('data-state', 'paused')
  click(container, 'adventure-resume'); wait(200)
  expect(Number(world(container).getAttribute('data-distance'))).toBeGreaterThan(Number(distance))
})

test('actual third-scene completion notifies the captured callback once with a stable round and account scope', async () => {
  const originalCallback = jest.fn(); const replacementCallback = jest.fn()
  const { container, rerender } = render(<PetAdventureGame active pet={pet} accountId='account:original-pet' onFinished={originalCallback} onExit={jest.fn()} />)
  click(container, 'adventure-start')
  rerender(<PetAdventureGame active pet={pet} accountId='account:original-pet' onFinished={replacementCallback} onExit={jest.fn()} />)
  await finishThreeScenes(container)
  expect(container.querySelector('#adventure-result')).toHaveAttribute('data-completed', 'true')
  expect(originalCallback).toHaveBeenCalledTimes(1)
  expect(originalCallback).toHaveBeenCalledWith(expect.objectContaining({ levelId: 1, completed: true, completedScenes: 3, landmarks: expect.arrayContaining(['door-root', 'door-bridge', 'door-home']) }), expect.stringMatching(/^adventure:/), 'account:original-pet')
  expect(replacementCallback).not.toHaveBeenCalled()
  wait(5000); expect(originalCallback).toHaveBeenCalledTimes(1)
})

test('account changes reset the trip without assigning an old round to the new companion', async () => {
  const callback = jest.fn()
  const { container, rerender } = render(<PetAdventureGame active pet={pet} accountId='account-one:original-pet' onFinished={callback} onExit={jest.fn()} />)
  click(container, 'adventure-start'); wait(500)
  rerender(<PetAdventureGame active pet={{ ...pet, id: 'other-pet', name: '小麦' }} accountId='account-two:other-pet' onFinished={callback} onExit={jest.fn()} />)
  await timeoutRound()
  expect(world(container)).toHaveAttribute('data-state', 'ready')
  expect(screen.getByTestId('current-pet')).toHaveTextContent('小麦')
  expect(callback).not.toHaveBeenCalled()
})

test('parent unsaved results and thrown callbacks both retain the same round for retry', async () => {
  const retry = jest.fn()
  const { container } = render(<PetAdventureGame active pet={pet} accountId='account:original-pet' onFinished={jest.fn()} onRetrySettlement={retry} settlementText='收获尚未保存，重试后再离开' onExit={jest.fn()} />)
  click(container, 'adventure-start'); await timeoutRound()
  expect(container.querySelector('#adventure-retry-settlement')).toBeInTheDocument()
  expect(container.querySelector('#adventure-retry')).toBeDisabled()
  expect(container.querySelector('#adventure-result-exit')).toBeDisabled()
  await act(async () => { click(container, 'adventure-retry-settlement'); await Promise.resolve(); await Promise.resolve() })
  expect(retry).toHaveBeenCalledTimes(1)
})

test('callback rejection locks leaving and its local retry reuses the original result and round id', async () => {
  const callback = jest.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
  const { container } = render(<PetAdventureGame active pet={pet} accountId='account:original-pet' onFinished={callback} onExit={jest.fn()} />)
  click(container, 'adventure-start'); await timeoutRound()
  expect(container.querySelector('#adventure-back')).toBeDisabled()
  expect(container.querySelector('#adventure-retry')).toBeDisabled()
  const firstCall = callback.mock.calls[0]
  await act(async () => { click(container, 'adventure-retry-settlement'); await Promise.resolve(); await Promise.resolve() })
  expect(callback.mock.calls[1]).toEqual(firstCall)
  expect(container.querySelector('#adventure-retry')).not.toBeDisabled()
})
