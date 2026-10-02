import { act, fireEvent, render, screen } from '@testing-library/react'
import { useDidHide } from '@tarojs/taro'
import { PetMergeGame } from '../../src/packagePetStudio/components/PetMergeGame'
import type { PetProfile } from '../../src/utils/api'

jest.mock('../../src/components/PetActor', () => ({
  PetActor: ({ pet, action, active, showStatus }: { pet: { name: string }; action: string; active: boolean; showStatus: boolean }) => <span data-testid='current-pet' data-action={action} data-active={active} data-adaptation={showStatus}>{pet.name}</span>,
}))
const pet = { id: 'original-pet', name: '小麦' } as PetProfile
const accountId = 'account-one'

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-10-02T00:00:00Z'))
  ;(useDidHide as jest.Mock).mockClear()
})
afterEach(() => jest.useRealTimers())

function click(container: HTMLElement, id: string) {
  const element = container.querySelector(`#${id}`)
  expect(element).not.toBeNull()
  fireEvent.click(element as Element)
}
function board(container: HTMLElement) { return container.querySelector('#merge-board') as HTMLElement }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }

function firstPlate(container: HTMLElement) {
  click(container, 'merge-recipe-breakfast')
  ;[0, 10, 20].forEach(cell => click(container, `merge-cell-${cell}`))
  click(container, 'merge-submit')
}
function finishBreakfast(container: HTMLElement) {
  firstPlate(container)
  click(container, 'merge-left')
  click(container, 'merge-down')
  click(container, 'merge-recipe-morning-bowl')
  for (const name of ['主食一级', '蔬果一级', '蛋白一级']) {
    const tile = container.querySelector(`#merge-board button[aria-label='${name}']`)
    expect(tile).not.toBeNull()
    fireEvent.click(tile as Element)
  }
  click(container, 'merge-submit')
}

test('recipe submission, actual directional input and undo change the playable board', () => {
  const { container } = render(<PetMergeGame active pet={pet} accountId={accountId} onFinished={jest.fn()} onExit={jest.fn()} />)
  expect(screen.getByTestId('current-pet')).toHaveTextContent('小麦')
  expect(screen.getByTestId('current-pet')).toHaveAttribute('data-adaptation', 'true')
  click(container, 'merge-start')
  firstPlate(container)
  expect(board(container)).toHaveAttribute('data-steps', '1')
  expect(board(container)).toHaveAttribute('data-score', '210')
  expect(container.querySelector('#merge-cell-0')).toHaveAttribute('aria-label', '空格')
  expect(container.querySelector('#merge-recipe-breakfast')).toBeDisabled()
  click(container, 'merge-undo')
  expect(board(container)).toHaveAttribute('data-steps', '0')
  expect(board(container)).toHaveAttribute('data-score', '0')
  expect(container.querySelector('#merge-cell-0')).toHaveAttribute('aria-label', '主食一级')
  expect(container.querySelector('#merge-undo')).toBeDisabled()
  fireEvent.touchStart(board(container), { touches: [{ clientX: 160, clientY: 100 }] })
  fireEvent.touchEnd(board(container), { changedTouches: [{ clientX: 60, clientY: 106 }] })
  expect(board(container)).toHaveAttribute('data-steps', '1')
  expect(board(container)).toHaveAttribute('data-score', '40')
  expect(container.querySelector('#merge-cell-0')).toHaveAttribute('aria-label', '主食二级')
})

test('background, inactive screen and explicit pause freeze input until manual resume', () => {
  const callback = jest.fn()
  const { container, rerender } = render(<PetMergeGame active pet={pet} accountId={accountId} onFinished={callback} onExit={jest.fn()} />)
  click(container, 'merge-start')
  click(container, 'merge-left')
  expect(screen.getByTestId('current-pet')).toHaveAttribute('data-active', 'true')
  const steps = board(container).getAttribute('data-steps')
  const hideCalls = (useDidHide as jest.Mock).mock.calls
  const hide = hideCalls[hideCalls.length - 1][0] as () => void
  act(() => hide())
  click(container, 'merge-right')
  expect(board(container)).toHaveAttribute('data-state', 'paused')
  expect(screen.getByTestId('current-pet')).toHaveAttribute('data-active', 'false')
  expect(board(container)).toHaveAttribute('data-steps', steps)
  click(container, 'merge-resume')
  expect(board(container)).toHaveAttribute('data-state', 'running')
  expect(screen.getByTestId('current-pet')).toHaveAttribute('data-active', 'true')
  rerender(<PetMergeGame active={false} pet={pet} accountId={accountId} onFinished={callback} onExit={jest.fn()} />)
  expect(board(container)).toHaveAttribute('data-state', 'paused')
  expect(container.querySelector('#merge-resume')).toBeDisabled()
  rerender(<PetMergeGame active pet={pet} accountId={accountId} onFinished={callback} onExit={jest.fn()} />)
  expect(board(container)).toHaveAttribute('data-state', 'paused')
  click(container, 'merge-resume')
  click(container, 'merge-right')
  expect(Number(board(container).getAttribute('data-steps'))).toBeGreaterThan(Number(steps))
  expect(callback).not.toHaveBeenCalled()
})

test('a genuine completed round reports measured score once to its captured account callback', async () => {
  const original = jest.fn()
  const replacement = jest.fn()
  const { container, rerender } = render(<PetMergeGame active pet={pet} accountId={accountId} onFinished={original} onExit={jest.fn()} />)
  click(container, 'merge-start')
  rerender(<PetMergeGame active pet={pet} accountId={accountId} onFinished={replacement} onExit={jest.fn()} />)
  finishBreakfast(container)
  await flush()
  expect(container.querySelector('#merge-result')).toBeInTheDocument()
  expect(original).toHaveBeenCalledTimes(1)
  expect(original).toHaveBeenCalledWith({
    game: 'merge', levelId: 1, score: 420, completed: true, stars: 3,
    collectibles: ['merge-tricolor-plate'],
    detail: { steps: 4, plates: 2, highestRank: 1, merges: 0, blocked: 0 },
  }, expect.stringMatching(/^merge:[a-z0-9]+:[0-9]+:[a-z0-9]+$/), accountId)
  expect(replacement).not.toHaveBeenCalled()
  rerender(<PetMergeGame active pet={pet} accountId={accountId} onFinished={replacement} onExit={jest.fn()} settlementText='成果已保存' />)
  await flush()
  expect(original).toHaveBeenCalledTimes(1)
  expect(container.querySelector('#merge-result-exit')).toBeEnabled()
})

test.each([
  ['account', { ...pet }, 'account-two'],
  ['pet', { ...pet, id: 'new-pet', name: '小松' }, accountId],
] as const)('%s change discards the old board without submitting it to the new owner', async (_, nextPet, nextAccount) => {
  const callback = jest.fn()
  const { container, rerender } = render(<PetMergeGame active pet={pet} accountId={accountId} onFinished={callback} onExit={jest.fn()} />)
  click(container, 'merge-start')
  firstPlate(container)
  rerender(<PetMergeGame active pet={nextPet} accountId={nextAccount} onFinished={callback} onExit={jest.fn()} />)
  await flush()
  expect(container.querySelector('#merge-board')).not.toBeInTheDocument()
  expect(container.querySelector('#merge-start')).toBeEnabled()
  expect(screen.getByTestId('current-pet')).toHaveTextContent(nextPet.name)
  expect(callback).not.toHaveBeenCalled()
})

test('failed saving preserves the finished round, blocks exits and retries the same measured result', async () => {
  const callback = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const onExit = jest.fn()
  const { container } = render(<PetMergeGame active pet={pet} accountId={accountId} onFinished={callback} onExit={onExit} />)
  click(container, 'merge-start')
  finishBreakfast(container)
  await flush()
  expect(container.querySelector('#merge-retry-settlement')).toBeInTheDocument()
  for (const id of ['merge-back', 'merge-retry', 'merge-result-exit', 'merge-menu']) {
    expect(container.querySelector(`#${id}`)).toBeDisabled()
    click(container, id)
  }
  expect(onExit).not.toHaveBeenCalled()
  const [result, roundId, sessionAccount] = callback.mock.calls[0]
  click(container, 'merge-retry-settlement')
  await flush()
  expect(callback).toHaveBeenLastCalledWith(result, roundId, sessionAccount)
  expect(callback).toHaveBeenCalledTimes(2)
  expect(container.querySelector('#merge-result')).toBeInTheDocument()
  expect(container.querySelector('#merge-result-exit')).toBeEnabled()
  click(container, 'merge-result-exit')
  expect(onExit).toHaveBeenCalledTimes(1)
})

test('an owner switch before the settlement microtask cancels the old result notification', async () => {
  const callback = jest.fn()
  const { container, rerender } = render(<PetMergeGame active pet={pet} accountId={accountId} onFinished={callback} onExit={jest.fn()} />)
  click(container, 'merge-start')
  finishBreakfast(container)
  rerender(<PetMergeGame active pet={{ ...pet, id: 'another-pet', name: '小松' }} accountId='account-two' onFinished={callback} onExit={jest.fn()} />)
  await flush()
  expect(callback).not.toHaveBeenCalled()
  expect(container.querySelector('#merge-result')).not.toBeInTheDocument()
  expect(container.querySelector('#merge-start')).toBeEnabled()
  expect(screen.getByTestId('current-pet')).toHaveTextContent('小松')
})

test('parent unsaved state keeps actions blocked until retry prop clears', async () => {
  const callback = jest.fn()
  const retry = jest.fn().mockResolvedValue(undefined)
  const props = { active: true, pet, accountId, onFinished: callback, onExit: jest.fn() }
  const { container, rerender } = render(<PetMergeGame {...props} />)
  click(container, 'merge-start')
  finishBreakfast(container)
  await flush()
  rerender(<PetMergeGame {...props} onRetrySettlement={retry} settlementText='成果待保存' />)
  expect(container.querySelector('#merge-retry')).toBeDisabled()
  expect(container.querySelector('#merge-result-exit')).toBeDisabled()
  click(container, 'merge-retry-settlement')
  await flush()
  expect(retry).toHaveBeenCalledTimes(1)
  expect(callback).toHaveBeenCalledTimes(1)
  expect(container.querySelector('#merge-result-exit')).toBeDisabled()
  rerender(<PetMergeGame {...props} settlementText='成果已保存' />)
  expect(container.querySelector('#merge-result-exit')).toBeEnabled()
})

test('leaving an unfinished round does not award or submit any result', async () => {
  const callback = jest.fn()
  const onExit = jest.fn()
  const { container } = render(<PetMergeGame active pet={pet} accountId={accountId} onFinished={callback} onExit={onExit} />)
  click(container, 'merge-start')
  firstPlate(container)
  click(container, 'merge-back')
  click(container, 'merge-exit')
  await flush()
  expect(onExit).toHaveBeenCalledTimes(1)
  expect(callback).not.toHaveBeenCalled()
})

test('a real terminal failure records actual progress and can restart after saving', async () => {
  const callback = jest.fn()
  const { container } = render(<PetMergeGame active pet={pet} accountId={accountId} onFinished={callback} onExit={jest.fn()} />)
  click(container, 'merge-start')
  const directions = ['down', 'left', 'up', 'right']
  for (let turn = 0; turn < 160 && container.querySelector('#merge-board'); turn += 1) click(container, `merge-${directions[turn % 4]}`)
  await flush()
  expect(container.querySelector('#merge-result')).toBeInTheDocument()
  expect(callback).toHaveBeenCalledTimes(1)
  const [result, roundId] = callback.mock.calls[0]
  expect(result).toMatchObject({ game: 'merge', completed: false, stars: 0, collectibles: [] })
  expect(result.detail.steps).toBeGreaterThan(0)
  expect(result.detail.steps).toBeLessThanOrEqual(28)
  expect(result.detail.plates).toBe(0)
  expect(container.querySelector('#merge-result')).toHaveTextContent(`${result.score} 游戏分`)
  click(container, 'merge-retry')
  expect(board(container)).toHaveAttribute('data-state', 'running')
  expect(board(container)).toHaveAttribute('data-steps', '0')
  expect(board(container)).toHaveAttribute('data-score', '0')
  expect(callback.mock.calls[0][1]).toBe(roundId)
  expect(callback).toHaveBeenCalledTimes(1)
})

test('unmounting before the queued result notification prevents submitting the detached game', async () => {
  const callback = jest.fn()
  const { container, unmount } = render(<PetMergeGame active pet={pet} accountId={accountId} onFinished={callback} onExit={jest.fn()} />)
  click(container, 'merge-start')
  finishBreakfast(container)
  unmount()
  await flush()
  expect(callback).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(0)
})
