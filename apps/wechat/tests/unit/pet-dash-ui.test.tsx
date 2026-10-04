import { act, fireEvent, render, screen } from '@testing-library/react'
import { PetDashGame } from '../../src/packagePetStudio/components/PetDashGame'
import { createDashGame } from '../../src/utils/pet-dash-game'
import type { PetProfile } from '../../src/utils/api'

jest.mock('../../src/components/PetActor', () => ({ PetActor: ({ pet, action, active }: { pet: PetProfile; action: string; active: boolean }) => <span data-testid='dash-pet' data-action={action} data-active={active}>{pet.name}</span> }))
const pet = { id: 'chosen-pet', name: '鬼鬼' } as PetProfile
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-05T00:00:00Z')) })
afterEach(() => jest.useRealTimers())
function click(container: HTMLElement, id: string) { fireEvent.click(container.querySelector(`#${id}`)!) }
function wait(ms: number) { act(() => { jest.advanceTimersByTime(ms) }) }
function world(container: HTMLElement) { return container.querySelector('#adventure-world')! }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
async function win(container: HTMLElement) {
  for (const obstacle of createDashGame().obstacles) {
    const elapsed = 30000 - Number(world(container).getAttribute('data-remaining'))
    wait(obstacle.distance * 100 - elapsed - 400)
    click(container, 'adventure-jump'); wait(400)
  }
  wait(Number(world(container).getAttribute('data-remaining')) + 40)
  await flush()
}

test('quick play starts the selected pet immediately; timed jumps win a real round and notify only its captured callback', async () => {
  const callback = jest.fn(); const replacement = jest.fn()
  const { container, rerender } = render(<PetDashGame active quickStart pet={pet} accountId='account' onExit={jest.fn()} onFinished={callback} />)
  expect(world(container)).toHaveAttribute('data-state', 'running')
  expect(screen.getByTestId('dash-pet')).toHaveTextContent('鬼鬼')
  expect(callback).not.toHaveBeenCalled()
  rerender(<PetDashGame active quickStart pet={pet} accountId='account' onExit={jest.fn()} onFinished={replacement} />)
  await win(container)
  expect(callback).toHaveBeenCalledTimes(1)
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ completed: true, successfulJumps: 12, bestCombo: 12, collectibleIds: expect.arrayContaining(['adventure-story-1']) }), expect.stringMatching(/^dash:/), 'account')
  expect(replacement).not.toHaveBeenCalled()
  expect(container.querySelector('#adventure-home')).toBeEnabled()
  wait(3000); expect(callback).toHaveBeenCalledTimes(1)
})

test('hiding pauses the real timer and actor, and foregrounding requires explicit resume', () => {
  const props = { pet, accountId: 'account', onExit: jest.fn(), onFinished: jest.fn() }
  const { container, rerender } = render(<PetDashGame active quickStart {...props} />)
  wait(400)
  const remaining = world(container).getAttribute('data-remaining')
  rerender(<PetDashGame active={false} quickStart {...props} />)
  wait(5000)
  expect(world(container)).toHaveAttribute('data-state', 'paused')
  expect(world(container)).toHaveAttribute('data-remaining', remaining)
  expect(screen.getByTestId('dash-pet')).toHaveAttribute('data-active', 'false')
  rerender(<PetDashGame active quickStart {...props} />)
  expect(world(container)).toHaveAttribute('data-state', 'paused')
  click(container, 'adventure-resume'); wait(200)
  expect(Number(world(container).getAttribute('data-remaining'))).toBe(Number(remaining) - 200)
})

test('saving failure locks replay/exit and retry reuses the exact completed result and round ID', async () => {
  const callback = jest.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
  const { container } = render(<PetDashGame active quickStart pet={pet} accountId='account' onExit={jest.fn()} onFinished={callback} />)
  await win(container)
  expect(container.querySelector('#adventure-replay')).toBeDisabled()
  expect(container.querySelector('#adventure-exit')).toBeDisabled()
  click(container, 'adventure-retry-save'); await flush()
  expect(callback).toHaveBeenCalledTimes(2)
  expect(callback.mock.calls[1]).toEqual(callback.mock.calls[0])
  expect(container.querySelector('#adventure-replay')).toBeEnabled()
})

test('no input reports a genuine failure and changing account/character resets the old active round', async () => {
  const callback = jest.fn()
  const { container, rerender } = render(<PetDashGame active quickStart pet={pet} accountId='account' onExit={jest.fn()} onFinished={callback} />)
  wait(1000)
  const other = { id: 'other-pet', name: '建文' } as PetProfile
  rerender(<PetDashGame active quickStart pet={other} accountId='other-account' onExit={jest.fn()} onFinished={callback} />)
  expect(world(container)).toHaveAttribute('data-distance', '0')
  expect(screen.getByTestId('dash-pet')).toHaveTextContent('建文')
  wait(7000); await flush()
  expect(callback).toHaveBeenCalledTimes(1)
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ completed: false, successfulJumps: 0, jumpInputs: 0, score: 0, collectibleIds: [] }), expect.any(String), 'other-account')
})

test('leaving an unfinished game clears its timer and cannot settle after unmount', async () => {
  const callback = jest.fn()
  const { unmount } = render(<PetDashGame active quickStart pet={pet} accountId='account' onExit={jest.fn()} onFinished={callback} />)
  expect(jest.getTimerCount()).toBe(1)
  unmount(); wait(30000); await flush()
  expect(jest.getTimerCount()).toBe(0)
  expect(callback).not.toHaveBeenCalled()
})

test('a foreground long frame consumes real time instead of extending the run', () => {
  const { container } = render(<PetDashGame active quickStart pet={pet} accountId='account' onExit={jest.fn()} onFinished={jest.fn()} />)
  jest.setSystemTime(Date.now() + 1000)
  wait(40)
  expect(world(container)).toHaveAttribute('data-remaining', '28960')
})

test('switching a completed quick game to another owner cannot rebind the old result to a new session', async () => {
  const first = jest.fn(); const second = jest.fn()
  const { container, rerender } = render(<PetDashGame active quickStart pet={pet} accountId='account' onExit={jest.fn()} onFinished={first} />)
  await win(container)
  const other = { id: 'next-pet', name: '建文' } as PetProfile
  rerender(<PetDashGame active quickStart pet={other} accountId='next-account' onExit={jest.fn()} onFinished={second} />)
  await flush()
  expect(world(container)).toHaveAttribute('data-state', 'running')
  expect(world(container)).toHaveAttribute('data-score', '0')
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).not.toHaveBeenCalled()
})
