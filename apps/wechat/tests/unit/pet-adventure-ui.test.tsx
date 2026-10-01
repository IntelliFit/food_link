import { act, fireEvent, render, screen } from '@testing-library/react'
import { PetAdventureGame } from '../../src/packagePetStudio/components/PetAdventureGame'
import type { PetProfile } from '../../src/utils/api'

jest.mock('../../src/components/PetIdentityAvatar', () => ({
  PetIdentityAvatar: ({ pet }: { pet?: { name: string } }) => <span data-testid='current-pet'>{pet?.name}</span>,
}))
const pet = { id: 'original-pet', name: '鬼鬼' } as PetProfile

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-10-01T00:00:00Z'))
})
afterEach(() => jest.useRealTimers())

function click(container: HTMLElement, id: string) {
  const element = container.querySelector(`#${id}`)
  expect(element).not.toBeNull()
  fireEvent.click(element as Element)
}
function world(container: HTMLElement) { return container.querySelector('#adventure-world') as HTMLElement }
function wait(milliseconds: number) { act(() => { jest.advanceTimersByTime(milliseconds) }) }
async function finishRound() {
  await act(async () => {
    jest.advanceTimersByTime(45000)
    await Promise.resolve()
    await Promise.resolve()
  })
}

test('lane changes, jumps and dashes operate the actual runner state with the selected pet', () => {
  const { container } = render(<PetAdventureGame active pet={pet} accountId='account:original-pet' onExit={jest.fn()} />)
  expect(screen.getByTestId('current-pet')).toHaveTextContent('鬼鬼')
  click(container, 'adventure-start')
  click(container, 'adventure-left')
  expect(world(container)).toHaveAttribute('data-lane', '-1')
  expect(container.querySelector('#adventure-left')).toBeDisabled()
  click(container, 'adventure-right')
  expect(world(container)).toHaveAttribute('data-lane', '0')
  fireEvent.touchStart(world(container), { touches: [{ clientX: 100, clientY: 100 }] })
  fireEvent.touchEnd(world(container), { changedTouches: [{ clientX: 160, clientY: 110 }] })
  expect(world(container)).toHaveAttribute('data-lane', '1')
  click(container, 'adventure-left')
  click(container, 'adventure-jump')
  expect(Number(world(container).getAttribute('data-jump'))).toBeGreaterThan(0)
  expect(container.querySelector('#adventure-jump')).toBeDisabled()
  click(container, 'adventure-dash')
  expect(Number(world(container).getAttribute('data-dash'))).toBeGreaterThan(0)
  expect(world(container)).toHaveAttribute('data-charge', '0')
  wait(200)
  expect(Number(world(container).getAttribute('data-distance'))).toBeGreaterThan(0)
})

test('backgrounding freezes the trip and returning requires explicit resume', () => {
  const { container, rerender } = render(<PetAdventureGame active pet={pet} accountId='account:original-pet' onExit={jest.fn()} />)
  click(container, 'adventure-start')
  wait(500)
  const distance = world(container).getAttribute('data-distance')
  rerender(<PetAdventureGame active={false} pet={pet} accountId='account:original-pet' onExit={jest.fn()} />)
  wait(5000)
  expect(world(container)).toHaveAttribute('data-state', 'paused')
  expect(world(container)).toHaveAttribute('data-distance', distance)
  expect(container.querySelector('#adventure-resume')).toBeDisabled()
  rerender(<PetAdventureGame active pet={pet} accountId='account:original-pet' onExit={jest.fn()} />)
  expect(world(container)).toHaveAttribute('data-state', 'paused')
  click(container, 'adventure-resume')
  wait(200)
  expect(Number(world(container).getAttribute('data-distance'))).toBeGreaterThan(Number(distance))
})

test('a round notifies its captured callback once with its original account scope and round id', async () => {
  const originalCallback = jest.fn()
  const replacementCallback = jest.fn()
  const { container, rerender } = render(<PetAdventureGame active pet={pet} accountId='account:original-pet' onFinished={originalCallback} onExit={jest.fn()} />)
  click(container, 'adventure-start')
  rerender(<PetAdventureGame active pet={pet} accountId='account:original-pet' onFinished={replacementCallback} onExit={jest.fn()} />)
  await finishRound()
  expect(container.querySelector('#adventure-result')).toBeInTheDocument()
  expect(originalCallback).toHaveBeenCalledTimes(1)
  expect(originalCallback).toHaveBeenCalledWith(expect.objectContaining({ levelId: 1, elapsedMs: expect.any(Number), score: expect.any(Number) }), expect.stringMatching(/^adventure:/), 'account:original-pet')
  expect(replacementCallback).not.toHaveBeenCalled()
  wait(5000)
  expect(originalCallback).toHaveBeenCalledTimes(1)
})

test('account changes reset the trip without attributing the old round to the new companion', async () => {
  const callback = jest.fn()
  const { container, rerender } = render(<PetAdventureGame active pet={pet} accountId='account-one:original-pet' onFinished={callback} onExit={jest.fn()} />)
  click(container, 'adventure-start')
  wait(500)
  rerender(<PetAdventureGame active pet={{ ...pet, id: 'other-pet', name: '小麦' }} accountId='account-two:other-pet' onFinished={callback} onExit={jest.fn()} />)
  await finishRound()
  expect(world(container)).toHaveAttribute('data-state', 'ready')
  expect(screen.getByTestId('current-pet')).toHaveTextContent('小麦')
  expect(callback).not.toHaveBeenCalled()
})

test('a parent-reported unsaved result offers retry even if the finish callback did not throw', async () => {
  const retry = jest.fn()
  const { container } = render(<PetAdventureGame active pet={pet} accountId='account:original-pet' onFinished={jest.fn()} onRetrySettlement={retry} settlementText='收获尚未保存，重试后再离开' onExit={jest.fn()} />)
  click(container, 'adventure-start')
  await finishRound()
  expect(container.querySelector('#adventure-retry-settlement')).toBeInTheDocument()
  expect(container.querySelector('#adventure-retry')).toBeDisabled()
  expect(container.querySelector('#adventure-result-exit')).toBeDisabled()
  await act(async () => { click(container, 'adventure-retry-settlement'); await Promise.resolve(); await Promise.resolve() })
  expect(retry).toHaveBeenCalledTimes(1)
})
