import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetStudioPage from '../../src/packagePetStudio/pages/index/index'
import { getBodyMetricsSummary, getExerciseLogs, getPetSummary, type PetProfile } from '../../src/utils/api'
import { GROWTH_CHAPTERS, buyGrowthItem, newGrowthSave, newPetJourney, settleGrowthRound, type GrowthGame, type GrowthSave } from '../../src/utils/pet-growth'
import { GROWTH_CHANGED, growthStorageKey, readGrowth, writeGrowth } from '../../src/utils/pet-growth-storage'
import { HOME_COMPANION_PREFERENCE_KEY, ORIGINAL_COMPANION_SRC } from '../../src/utils/pet-companion-preference'
import { HOME_PET_PROFILE_CHANGED_EVENT } from '../../src/utils/pet-events'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../src/utils/home-events'
import { PET_LOADOUT_CHANGED, readPetLoadout } from '../../src/utils/pet-loadout'
import { PET_TRANSPORT_CHANGED, petTransportStorageKey } from '../../src/utils/pet-transport-storage'
import { extraPkgUrl } from '../../src/utils/subpackage-extra'
import { createAdventureProgress } from '../../src/utils/pet-adventure-progress'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/utils/api', () => ({ getPetSummary: jest.fn(), getBodyMetricsSummary: jest.fn(), getExerciseLogs: jest.fn() }))
// Game engines, inputs and storage/settlement code stay real. Only sprite
// rendering is replaced so lifecycle assertions measure game timers alone.
jest.mock('../../src/components/PetActor', () => ({
  ...jest.requireActual('../../src/components/PetActor'),
  PetActor: ({ pet, scarf, active }: { pet: PetProfile; scarf?: string; active: boolean }) => <span data-testid='hub-pet' data-pet-id={pet.id} data-scarf={scarf || ''} data-active={active}>{pet.name}</span>,
}))

const user = 'test-user'
const pet = { id: 'pet', name: '小麦', builtin_avatar_id: 'jianwen-01' } as PetProfile
const day = '2026-10-02'
let storage: Map<string, any>
let show: (() => void) | undefined
let hide: (() => void) | undefined
let failGrowthWrites: boolean
let failIdentityReads: boolean
let listeners: Map<string, Set<(...args: any[]) => void>>
const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))
const preferenceKey = (account: string) => `${HOME_COMPANION_PREFERENCE_KEY}:${account}`
const loadoutKey = (account = user, petId = pet.id) => `pet_loadout_v2:${account}:${petId}:${encodeURIComponent(ORIGINAL_COMPANION_SRC)}`

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  jest.setSystemTime(new Date(`${day}T00:00:00Z`))
  storage = new Map<string, any>([
    ['user_id', user],
    [preferenceKey(user), { selected: 'original', enabledOriginal: true }],
  ])
  failGrowthWrites = false; failIdentityReads = false; listeners = new Map(); show = undefined; hide = undefined
  let pageHideIsNext = false
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => { show = callback; pageHideIsNext = true })
  // Page show/hide are registered together; games register hide alone.
  ;(Taro.useDidHide as jest.Mock).mockImplementation(callback => { if (pageHideIsNext) { hide = callback; pageHideIsNext = false } })
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => {
    if (key === 'user_id' && failIdentityReads) throw new Error('storage temporarily unavailable')
    return clone(storage.has(key) ? storage.get(key) : '')
  })
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => {
    if (failGrowthWrites && key.startsWith('pet_growth_v2:')) throw new Error('disk full')
    storage.set(key, clone(value))
  })
  ;(Taro.eventCenter.on as jest.Mock).mockImplementation((event, callback) => {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(callback)
  })
  ;(Taro.eventCenter.off as jest.Mock).mockImplementation((event, callback) => { listeners.get(event)?.delete(callback) })
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementation((event, ...args) => { [...(listeners.get(event) || [])].forEach(callback => callback(...args)) })
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet })
  ;(getBodyMetricsSummary as jest.Mock).mockResolvedValue({ water_daily: [] })
  ;(getExerciseLogs as jest.Mock).mockResolvedValue({ logs: [] })
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([])
})

afterEach(() => jest.useRealTimers())

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
async function mount() {
  const result = render(<PetStudioPage />)
  await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve() })
  return result
}
function click(container: HTMLElement, id: string) {
  const element = container.querySelector(`#${id}`)
  expect(element).not.toBeNull()
  fireEvent.click(element as Element)
}
function saved(account = user): GrowthSave { return clone(storage.get(growthStorageKey(account))) }
function writes(account = user): GrowthSave[] { return (Taro.setStorageSync as jest.Mock).mock.calls.filter(([key]) => key === growthStorageKey(account)).map(([, value]) => clone(value)) }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function seedChapterPrerequisites() {
  let next = newGrowthSave()
  const rounds: [GrowthGame, number, Record<string, number>][] = [
    ['adventure', 1, { distance: 300 }], ['merge', 1, { steps: 4 }],
    ['merge', 2, { steps: 4 }], ['adventure', 2, { distance: 300 }],
  ]
  rounds.forEach(([game, levelId, detail], index) => {
    const landmarks = game === 'explore' ? levelId === 1 ? ['clue', 'canal', 'pebble'] : ['clue', 'slate', 'letter'] : undefined
    const update = settleGrowthRound(next, pet.id, { game, levelId, detail, landmarks, score: 420, completed: true, stars: 3, collectibles: [] }, `fixture:${index}`, day)
    expect(update.ok).toBe(true); next = update.save
  })
  next.migratedPets.push(pet.id)
  storage.set(growthStorageKey(user), clone(next))
  return next
}
function serveFirstMergePlate(container: HTMLElement) {
  click(container, 'merge-recipe-breakfast')
  ;[0, 10, 20].forEach(cell => click(container, `merge-cell-${cell}`))
  click(container, 'merge-submit')
}
function finishMergeFromFirstPlate(container: HTMLElement) {
  click(container, 'merge-left'); click(container, 'merge-down')
  click(container, 'merge-recipe-morning-bowl')
  for (const name of ['主食一级', '蔬果一级', '蛋白一级']) {
    const tile = container.querySelector(`#merge-board button[aria-label='${name}']`)
    expect(tile).not.toBeNull(); fireEvent.click(tile as Element)
  }
  click(container, 'merge-submit')
}
function finishMerge(container: HTMLElement) { serveFirstMergePlate(container); finishMergeFromFirstPlate(container) }
function startMerge(container: HTMLElement) { click(container, 'journey-tab-map'); click(container, 'journey-start-merge'); click(container, 'merge-start') }

test('growth replaces the map with four activities; saved water and exercise reward the shared wallet once', async () => {
  ;(getBodyMetricsSummary as jest.Mock).mockResolvedValue({ water_daily: [{ date: day, total: 250, logs: [250] }] })
  ;(getExerciseLogs as jest.Mock).mockResolvedValue({ logs: [{ id: 'e1', recorded_on: day }] })
  const { container } = await mount(); click(container, 'journey-tab-map'); await flush()
  expect(container.querySelector('.journey-map')).toBeNull()
  for (const kind of ['water', 'exercise', 'work', 'rest']) expect(container.querySelector(`#care-action-${kind}`)).toBeEnabled()
  click(container, 'care-action-water'); await flush(); click(container, 'care-action-exercise'); await flush()
  expect(saved().stars).toBe(4); expect(saved().pets[pet.id]).toMatchObject({ xp: 10, care: { water: 1, exercise: 1 } })
  expect(container.querySelector('#care-action-water')).toBeDisabled()
  act(() => Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)); await flush()
  expect(saved().stars).toBe(4)
  expect(container.querySelector('.journey-wallet')).toHaveTextContent('星光币')
})

test('record creation only navigates; a deleted saved record cannot be claimed from stale eligibility', async () => {
  const { container } = await mount(); click(container, 'journey-tab-map'); await flush()
  click(container, 'care-action-water')
  expect(Taro.navigateTo).toHaveBeenCalledWith({ url: `${extraPkgUrl('/pages/water-record/index')}?date=${day}` })
  expect(saved().stars).toBe(0)
  ;(getBodyMetricsSummary as jest.Mock).mockResolvedValueOnce({ water_daily: [{ date: day, total: 250, logs: [250] }] })
  act(() => Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)); await flush()
  ;(getBodyMetricsSummary as jest.Mock).mockResolvedValue({ water_daily: [] })
  click(container, 'care-action-water'); await flush()
  expect(saved().stars).toBe(0); expect(container.querySelector('#care-action-water')).toHaveTextContent('去记录')
})

test('a late eligibility response from the previous account cannot award or enable the new account', async () => {
  const late = deferred<any>(); (getBodyMetricsSummary as jest.Mock).mockReturnValueOnce(late.promise)
  const { container } = await mount(); click(container, 'journey-tab-map'); await flush()
  act(() => { storage.set('user_id', 'other-account'); show?.() }); await flush()
  await act(async () => { late.resolve({ water_daily: [{ date: day, total: 250, logs: [250] }] }); await Promise.resolve() }); await flush()
  expect(saved('other-account').stars).toBe(0)
  expect(container.querySelector('#care-action-water')).toHaveTextContent('去记录')
})

test('work pauses in the background and across tabs; resuming needs an explicit action and never counts hidden time', async () => {
  const { container, unmount } = await mount(); click(container, 'journey-tab-map'); await flush()
  click(container, 'care-action-work'); click(container, 'care-timer-start')
  act(() => jest.advanceTimersByTime(5000))
  expect(container.querySelector('#care-timer')).toHaveAttribute('data-elapsed', '5000')
  act(() => hide?.()); act(() => jest.advanceTimersByTime(600000))
  expect(saved().care?.sessions[pet.id]).toMatchObject({ elapsedMs: 5000, status: 'paused' }); expect(saved().stars).toBe(0)
  act(() => show?.()); await flush(); expect(container.querySelector('#care-timer-resume')).toBeEnabled()
  click(container, 'care-timer-resume'); act(() => jest.advanceTimersByTime(2000))
  click(container, 'journey-tab-home'); click(container, 'journey-tab-map'); await flush()
  expect(container.querySelector('#care-timer')).toHaveAttribute('data-elapsed', '7000')
  expect(container.querySelector('#care-timer-resume')).toBeEnabled(); expect(saved().stars).toBe(0)
  unmount(); expect(jest.getTimerCount()).toBe(0)
})

test('switching from work to rest explicitly requires finishing the existing timer and never replaces its progress', async () => {
  const { container } = await mount(); click(container, 'journey-tab-map'); await flush()
  click(container, 'care-action-work'); click(container, 'care-timer-start'); act(() => jest.advanceTimersByTime(2000))
  click(container, 'care-action-rest')
  expect(container.querySelector('.pet-growth-garden__speech')).toHaveTextContent('先结束已有计时')
  expect(saved().care?.sessions[pet.id]).toMatchObject({ kind: 'work', elapsedMs: 2000 })
  click(container, 'care-timer-cancel'); click(container, 'care-timer-start')
  expect(saved().care?.sessions[pet.id]).toMatchObject({ kind: 'rest', targetMs: 60000, elapsedMs: 0 })
})

test('completed timer reward survives write failure, tab changes and midnight, and retries once', async () => {
  const { container } = await mount(); click(container, 'journey-tab-map'); await flush()
  click(container, 'care-action-rest'); click(container, 'care-timer-start')
  failGrowthWrites = true; act(() => jest.advanceTimersByTime(60000))
  expect(saved().stars).toBe(0); expect(container.querySelector('#care-timer-claim')).toBeEnabled()
  click(container, 'journey-tab-home'); click(container, 'journey-tab-map'); await flush()
  expect(container.querySelector('#care-timer-claim')).toBeEnabled()
  failGrowthWrites = false; jest.setSystemTime(new Date('2026-10-03T12:00:00Z'))
  click(container, 'care-timer-claim'); await flush()
  expect(saved().stars).toBe(2); expect(saved().rounds).toContain(`care:${day}:rest`)
  expect(saved().care?.sessions[pet.id]).toBeUndefined()
  click(container, 'journey-tab-home'); click(container, 'journey-tab-map'); await flush()
  expect(container.querySelector('#care-timer-claim')).toBeNull(); expect(saved().stars).toBe(2)
})

test('an idle screen crossing midnight starts the new day, and failed interaction spends nothing', async () => {
  seedWallet(6)
  const { container } = await mount(); click(container, 'journey-tab-map'); await flush()
  click(container, 'care-action-work'); jest.setSystemTime(new Date('2026-10-03T12:00:00Z')); click(container, 'care-timer-start')
  expect(saved().care?.sessions[pet.id].day).toBe('2026-10-03')
  failGrowthWrites = true; click(container, 'care-use-ball')
  expect(saved().stars).toBe(6); expect(saved().pets[pet.id].care?.interactions).toBeUndefined()
  failGrowthWrites = false; click(container, 'care-use-ball')
  expect(saved().stars).toBe(0); expect(saved().pets[pet.id]).toMatchObject({ xp: 2, affinity: 2, care: { interactions: 1 } })
})

test('a free growth souvenir can be claimed and placed without spending coins', async () => {
  const seeded = seedWallet(0); seeded.pets[pet.id].xp = 40; storage.set(growthStorageKey(user), clone(seeded))
  const { container } = await mount(); click(container, 'journey-tab-map'); await flush()
  click(container, 'care-milestone-2')
  expect(saved().inventory).toContain('care-sprout'); expect(saved().stars).toBe(0)
  click(container, 'care-milestone-2'); click(container, 'journey-place-care-sprout'); click(container, 'journey-tab-home')
  expect(container.querySelector('.journey-room__prop')).toHaveTextContent('绿意小盆栽')
})

test.each(['merge'] as const)('the %s first-screen card opens the next real game immediately without paying a reward', async game => {
  const { container, unmount } = await mount()
  click(container, `journey-feature-${game}`); click(container, 'journey-play-now')
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-state', 'running')
  expect(container.querySelector(`#${game}-start`)).toBeNull()
  expect(saved().stars).toBe(0); expect(saved().rounds).toEqual([])
  unmount(); await flush()
  expect(saved().stars).toBe(0); expect(saved().rounds).toEqual([])
})

test('the first-screen button immediately starts a real run; no-input failure saves no currency or collection', async () => {
  const { container } = await mount()
  click(container, 'journey-play-now')
  expect(container.querySelector('#adventure-world')).toHaveAttribute('data-state', 'running')
  expect(container.querySelector('#adventure-start')).toBeNull()
  expect(saved().rounds).toEqual([]); expect(saved().stars).toBe(0)
  act(() => { jest.advanceTimersByTime(7000) }); await flush()
  expect(container.querySelector('#adventure-result')).toBeInTheDocument()
  expect(saved().stars).toBe(0)
  expect(saved().inventory).toEqual(['journey-card', 'cozy-scarf'])
  click(container, 'adventure-home')
  expect(container.querySelector('#journey-play-now')).toBeEnabled()
})

test('a timed first-screen run wins named keepsakes that can really be placed in the house', async () => {
  const { container } = await mount()
  click(container, 'journey-play-now')
  for (const distance of [18, 42, 66, 90, 114, 138, 162, 186, 210, 234, 258, 282]) {
    const remaining = Number(container.querySelector('#adventure-world')!.getAttribute('data-remaining'))
    act(() => { jest.advanceTimersByTime(distance * 100 - (30000 - remaining) - 400) })
    click(container, 'adventure-jump')
    act(() => { jest.advanceTimersByTime(400) })
  }
  act(() => { jest.advanceTimersByTime(1800) }); await flush()
  expect(saved().stars).toBe(6)
  expect(saved().pets[pet.id].cleared.adventure).toContain(1)
  expect(saved().inventory).toContain('trail-leaf')
  click(container, 'adventure-home'); click(container, 'journey-tab-collection')
  expect(container.querySelector('#journey-place-trail-leaf')).toHaveTextContent('旅途叶片')
  click(container, 'journey-place-trail-leaf'); click(container, 'journey-tab-home')
  expect(container.querySelector('.journey-room__prop')).toHaveTextContent('旅途叶片')
  expect(container.querySelector('#journey-play-now')).toBeEnabled()
})

function seedWallet(stars = 40) {
  const initial = newGrowthSave()
  initial.stars = stars; initial.migratedPets = [pet.id]; initial.pets[pet.id] = newPetJourney()
  storage.set(growthStorageKey(user), clone(initial))
  return initial
}

test('cold-start identity storage failure shows a retry and recovery starts a real game without requiring another show', async () => {
  failIdentityReads = true
  const { container } = await mount()
  expect(screen.getByRole('button', { name: '重试读取' })).toBeEnabled()
  expect(container.querySelector('.journey-spinner')).not.toBeInTheDocument()
  expect(getPetSummary).not.toHaveBeenCalled()
  expect(storage.has(growthStorageKey(user))).toBe(false)
  failIdentityReads = false
  fireEvent.click(screen.getByRole('button', { name: '重试读取' })); await flush()
  expect(screen.getByText('小麦的小屋')).toBeInTheDocument()
  expect(screen.getAllByTestId('hub-pet').every(actor => actor.getAttribute('data-active') === 'true')).toBe(true)
  expect(getPetSummary).toHaveBeenCalledTimes(1)
  click(container, 'journey-tab-map'); click(container, 'journey-start-merge')
  expect(container.querySelector('#merge-start')).toBeEnabled()
  click(container, 'merge-start'); click(container, 'merge-left')
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-state', 'running')
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-steps', '1')
  expect(saved().stars).toBe(0); expect(saved().rounds).toEqual([])
})

test('returning to an existing game refreshes another page purchase and reward without restarting the board or doubling currency', async () => {
  seedWallet()
  const pageA = await mount()
  startMerge(pageA.container); serveFirstMergePlate(pageA.container)
  expect(pageA.container.querySelector('#merge-board')).toHaveAttribute('data-steps', '1')
  const boardAfterFirstPlate = pageA.container.querySelector('#merge-board')!.textContent
  act(() => { hide?.() })
  const showA = show
  expect(pageA.container.querySelector('#merge-resume')).toBeDisabled()
  const pageB = await mount()
  click(pageB.container, 'journey-tab-collection'); click(pageB.container, 'journey-buy-leafboard')
  expect(saved().stars).toBe(0); expect(saved().inventory).toContain('leafboard')
  startMerge(pageB.container); finishMerge(pageB.container); await flush()
  expect(saved().stars).toBe(6)
  const committedByB = saved()
  expect(committedByB.rounds).toHaveLength(1)
  pageB.unmount()
  await act(async () => { showA?.(); await Promise.resolve(); await Promise.resolve() })
  expect(pageA.container.querySelector('#merge-resume')).toBeEnabled()
  click(pageA.container, 'merge-resume')
  expect(pageA.container.querySelector('#merge-board')).toHaveAttribute('data-steps', '1')
  expect(pageA.container.querySelector('#merge-board')!.textContent).toBe(boardAfterFirstPlate)
  finishMergeFromFirstPlate(pageA.container); await flush()
  expect(saved().stars).toBe(6)
  expect(saved().inventory).toContain('leafboard')
  expect(saved().rounds).toHaveLength(2)
  expect(saved().rounds).toContain(committedByB.rounds[0])
  expect(new Set(saved().rounds).size).toBe(2)
  expect(saved().daily).toEqual({ day, games: ['merge'], earned: 6 })
  expect(saved().revision).toBe(committedByB.revision + 1)
  click(pageA.container, 'merge-result-exit')
  expect(pageA.container.querySelector('.journey-wallet')).toHaveTextContent('✦ 6')
  expect(getPetSummary).toHaveBeenCalledTimes(2)
})

test('a growth change from another page updates the wallet and keeps a running game and its real input intact', async () => {
  seedWallet()
  const { container } = await mount()
  startMerge(container); click(container, 'merge-left')
  const purchase = buyGrowthItem(readGrowth(user, pet.id), 'leafboard')
  expect(purchase.ok).toBe(true)
  act(() => { expect(writeGrowth(user, purchase.save)).toBe(true) })
  expect(Taro.eventCenter.trigger).toHaveBeenCalledWith(GROWTH_CHANGED)
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-state', 'running')
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-steps', '1')
  click(container, 'merge-back'); click(container, 'merge-exit')
  expect(container.querySelector('.journey-wallet')).toHaveTextContent('✦ 0')
  expect(saved().inventory).toContain('leafboard')
  expect(saved().rounds).toEqual([])
  expect(getPetSummary).toHaveBeenCalledTimes(1)
})

test('a mutation rereads the latest ledger even when another page notification has not reached this page', async () => {
  seedWallet()
  const { container } = await mount()
  // Lost or delayed delivery must not make the rendered 40-star snapshot authoritative.
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementationOnce(() => undefined)
  const purchase = buyGrowthItem(readGrowth(user, pet.id), 'leafboard')
  expect(writeGrowth(user, purchase.save)).toBe(true)
  expect(container.querySelector('.journey-wallet')).toHaveTextContent('✦ 40')
  click(container, 'journey-pet-touch')
  expect(saved()).toMatchObject({ revision: 2, stars: 0, inventory: expect.arrayContaining(['leafboard']), pets: { [pet.id]: { affinity: 2, xp: 0 } } })
  expect(container.querySelector('.journey-wallet')).toHaveTextContent('✦ 0')
  click(container, 'journey-tab-collection'); click(container, 'journey-buy-plant')
  expect(saved().stars).toBe(0)
  expect(saved().inventory).not.toContain('plant')
  expect(saved().inventory).toContain('leafboard')
  expect(saved().revision).toBe(2)
})

test('a real round settles against the latest purchase even when its captured page snapshot missed the change event', async () => {
  seedWallet()
  const { container } = await mount()
  startMerge(container)
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementationOnce(() => undefined)
  const purchase = buyGrowthItem(readGrowth(user, pet.id), 'leafboard')
  expect(writeGrowth(user, purchase.save)).toBe(true)
  expect(saved()).toMatchObject({ revision: 1, stars: 0, inventory: expect.arrayContaining(['leafboard']) })
  finishMerge(container); await flush()
  expect(saved()).toMatchObject({ revision: 2, stars: 6, inventory: expect.arrayContaining(['leafboard', 'merge-tricolor-plate']), daily: { day, games: ['merge'], earned: 6 } })
  expect(saved().rounds).toHaveLength(1)
  expect(container.querySelector('#merge-result')).toHaveTextContent('420 游戏分')
  expect(container.querySelector('#merge-retry-settlement')).not.toBeInTheDocument()
  expect(container.querySelector('#merge-result-exit')).toBeEnabled()
})

test.each([
  ['merge', 'merge-board', 'merge-exit'],
  ['adventure', 'adventure-world', 'adventure-exit'],
] as const)('%s card in the growth page opens a playable game; leaving an unfinished game gives no reward', async (game, world, exit) => {
  const { container, unmount } = await mount()
  for (const entry of ['journey-start-']) {
    click(container, 'journey-tab-map'); click(container, `${entry}${game}`)
    expect(container.querySelector(`#${game}-start`)).toBeEnabled()
    expect(screen.getAllByTestId('hub-pet')[0]).toHaveAttribute('data-pet-id', pet.id)
    click(container, `${game}-start`)
    expect(container.querySelector(`#${world}`)).toBeInTheDocument()
    expect(container.querySelector(`#${world}`)).toHaveAttribute('data-state', 'running')
    click(container, `${game}-back`); click(container, exit)
    await flush()
    expect(screen.getByText('小麦的小屋')).toBeInTheDocument()
    expect(saved().stars).toBe(0); expect(saved().rounds).toEqual([])
  }
  expect(Taro.navigateTo).not.toHaveBeenCalled()
  unmount(); expect(jest.getTimerCount()).toBe(0)
})

test('all three chapter goals gate story choices, and prior stories unlock chapters in order', async () => {
  const initial = seedChapterPrerequisites()
  const { container } = await mount()
  click(container, 'journey-tab-story')
  expect(container.querySelectorAll('.journey-story__tasks .is-done')).toHaveLength(2)
  expect(container.querySelector('#journey-story-choice-0')).toBeDisabled()
  click(container, 'journey-chapter-2')
  expect(container.querySelectorAll('.journey-story__tasks .is-done')).toHaveLength(2)
  expect(container.querySelector('#journey-story-choice-0')).toBeDisabled()
  click(container, 'journey-chapter-3')
  expect(container.querySelectorAll('.journey-story__tasks .is-done')).toHaveLength(2)
  expect(container.querySelector('#journey-story-choice-0')).toBeDisabled()
  click(container, 'journey-tab-collection'); click(container, 'journey-slot-window'); click(container, 'journey-place-journey-card')
  click(container, 'journey-tab-story')
  for (const chapter of GROWTH_CHAPTERS) {
    click(container, `journey-chapter-${chapter.id}`)
    expect(container.querySelectorAll('.journey-story__tasks .is-done')).toHaveLength(3)
    expect(container.querySelector('#journey-story-choice-0')).toBeEnabled()
    click(container, 'journey-story-choice-0')
    expect(saved().pets[pet.id].chapters).toContain(chapter.id)
    expect(saved().pets[pet.id].choices[String(chapter.id)]).toBe(chapter.choices[0])
    expect(saved().inventory).toContain(chapter.reward)
  }
  expect(saved().stars).toBe(initial.stars)
  expect(saved().pets[pet.id].xp).toBe(initial.pets[pet.id].xp + 90)
  click(container, 'journey-story-choice-1')
  expect(saved().pets[pet.id].choices['3']).toBe(GROWTH_CHAPTERS[2].choices[1])
  expect(saved().pets[pet.id].xp).toBe(initial.pets[pet.id].xp + 90)
})

test.each(['adventure', 'merge', 'placement'] as const)('the first chapter cannot be selected when its %s condition is missing', async missing => {
  const next = seedChapterPrerequisites()
  next.pets[pet.id].placements.window = 'journey-card'
  if (missing === 'adventure') next.pets[pet.id].cleared.adventure = []
  if (missing === 'merge') next.pets[pet.id].cleared.merge = []
  if (missing === 'placement') next.pets[pet.id].placements.window = null
  storage.set(growthStorageKey(user), clone(next))
  const { container } = await mount()
  click(container, 'journey-tab-story')
  expect(container.querySelectorAll('.journey-story__tasks .is-done')).toHaveLength(2)
  click(container, 'journey-story-choice-0')
  expect(saved().pets[pet.id].chapters).toEqual([])
})

test('collection placement moves a single item and explicit outfit confirmation writes the shared wardrobe', async () => {
  const { container } = await mount()
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  click(container, 'journey-tab-collection')
  click(container, 'journey-outfit-cozy-scarf')
  expect(container.querySelector('.journey-dressing-stage [data-testid="hub-pet"]')).toHaveAttribute('data-scarf', 'cozy-scarf')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  click(container, 'journey-save-outfit')
  expect(Taro.setStorageSync).toHaveBeenCalledWith(loadoutKey(), { version: 2, appearance: ORIGINAL_COMPANION_SRC, scarf: 'cozy-scarf' })
  expect(Taro.eventCenter.trigger).toHaveBeenCalledWith(PET_LOADOUT_CHANGED)
  expect(readPetLoadout(pet.id, ORIGINAL_COMPANION_SRC)?.scarf).toBe('cozy-scarf')
  click(container, 'journey-slot-table'); click(container, 'journey-place-journey-card')
  click(container, 'journey-slot-floor'); click(container, 'journey-place-journey-card')
  expect(saved().pets[pet.id].placements).toEqual({ window: null, table: null, floor: 'journey-card' })
  click(container, 'journey-tab-home')
  expect(container.querySelectorAll('.journey-room__prop')).toHaveLength(1)
  expect(container.querySelector('.journey-room__prop.is-floor')).toHaveTextContent('初次出发旅途卡')
})

test('a template with no scarf anchors cannot preview or buy original-character clothing', async () => {
  storage.set(preferenceKey(user), { selected: 'follow', enabledOriginal: true })
  const { container } = await mount()
  click(container, 'journey-tab-collection')
  expect(container.querySelector('#journey-outfit-cozy-scarf')).toBeDisabled()
  expect(container.querySelector('#journey-buy-explorer-scarf')).toBeDisabled()
  click(container, 'journey-outfit-cozy-scarf')
  expect(container.querySelector('.journey-dressing-stage [data-testid="hub-pet"]')).toHaveAttribute('data-scarf', '')
  expect(storage.has(loadoutKey())).toBe(false)
})

test('template selection and healthy-life recording keep their existing tool routes', async () => {
  const { container } = await mount()
  click(container, 'journey-record-open')
  click(container, 'journey-tab-collection')
  fireEvent.click(screen.getByRole('button', { name: '选择其他模板 / 拍照生成伙伴 ›' }))
  expect(Taro.navigateTo).toHaveBeenNthCalledWith(1, { url: extraPkgUrl('/pages/record-text/index') })
  expect(Taro.navigateTo).toHaveBeenNthCalledWith(2, { url: extraPkgUrl('/pages/pet-home/index') })
})

test('an old getPetSummary response cannot replace or migrate the newly signed-in account', async () => {
  const oldResponse = deferred<{ pet: PetProfile }>()
  const nextPet = { ...pet, id: 'new-account-pet', name: '小松' }
  ;(getPetSummary as jest.Mock).mockReturnValueOnce(oldResponse.promise).mockResolvedValueOnce({ pet: nextPet })
  const { container } = await mount()
  storage.set('user_id', 'account-b'); storage.set(preferenceKey('account-b'), { selected: 'original', enabledOriginal: true })
  await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve() })
  expect(screen.getByText('小松的小屋')).toBeInTheDocument()
  await act(async () => { oldResponse.resolve({ pet }); await Promise.resolve(); await Promise.resolve() })
  expect(screen.getByText('小松的小屋')).toBeInTheDocument()
  expect(container.querySelector('.journey-room__name')).not.toHaveTextContent('小麦')
  expect(storage.has(growthStorageKey(user))).toBe(false)
  expect(Object.keys(saved('account-b').pets)).toEqual(['new-account-pet'])
})

test('account switching cancels an old outfit preview and never writes it to either account', async () => {
  const { container } = await mount()
  click(container, 'journey-tab-collection'); click(container, 'journey-outfit-cozy-scarf')
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  storage.set('user_id', 'account-b')
  click(container, 'journey-save-outfit')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { ...pet, id: 'pet-b', name: '小松' } })
  storage.set(preferenceKey('account-b'), { selected: 'original', enabledOriginal: true })
  await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve() })
  for (const actor of screen.getAllByTestId('hub-pet')) { expect(actor).toHaveTextContent('小松'); expect(actor).toHaveAttribute('data-scarf', '') }
  expect(storage.has(loadoutKey())).toBe(false)
  expect(storage.has(loadoutKey('account-b', 'pet-b'))).toBe(false)
})

test('switching accounts before the queued game callback prevents submitting the old score to either account', async () => {
  const { container } = await mount()
  startMerge(container); finishMerge(container)
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { ...pet, id: 'pet-b', name: '小松' } })
  storage.set('user_id', 'account-b')
  await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  expect(container.querySelector('#merge-result')).not.toBeInTheDocument()
  click(container, 'journey-tab-home')
  expect(screen.getByText('小松的小屋')).toBeInTheDocument()
  expect(saved().rounds).toEqual([]); expect(saved().stars).toBe(0)
  expect(saved('account-b').rounds).toEqual([]); expect(saved('account-b').stars).toBe(0)
})

test('switching accounts while a round needs saving clears its retry controls without assigning its reward to the new account', async () => {
  const { container } = await mount()
  startMerge(container); failGrowthWrites = true; finishMerge(container); await flush()
  expect(container.querySelector('#merge-retry-settlement')).toBeEnabled()
  const oldRoundId = writes().find(value => value.rounds.length > 0)!.rounds[0]
  failGrowthWrites = false
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { ...pet, id: 'pet-b', name: '小松' } })
  storage.set('user_id', 'account-b')
  await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve() })
  expect(container.querySelector('#merge-retry-settlement')).not.toBeInTheDocument()
  click(container, 'journey-tab-home')
  expect(screen.getByText('小松的小屋')).toBeInTheDocument()
  expect(saved().rounds).not.toContain(oldRoundId)
  expect(saved('account-b').rounds).not.toContain(oldRoundId)
  expect(saved().stars).toBe(0); expect(saved('account-b').stars).toBe(0)
})

test('a profile-changed event refreshes the same account after the existing template page returns', async () => {
  const { container } = await mount()
  click(container, 'journey-tab-collection')
  fireEvent.click(screen.getByRole('button', { name: '选择其他模板 / 拍照生成伙伴 ›' }))
  act(() => { hide?.() })
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { ...pet, name: '换了名字的小麦', builtin_avatar_id: '', pixel_avatar_url: 'https://example.com/my-pet.png' } })
  await act(async () => { Taro.eventCenter.trigger(HOME_PET_PROFILE_CHANGED_EVENT); show?.(); await Promise.resolve(); await Promise.resolve() })
  expect(getPetSummary).toHaveBeenCalledTimes(2)
  for (const actor of screen.getAllByTestId('hub-pet')) expect(actor).toHaveTextContent('换了名字的小麦')
})

test('the house transport shortcut opens trial and confirms under the actual selected original identity', async () => {
  const { container } = await mount()
  const ledger = saved()
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  click(container, 'journey-transport-open'); click(container, 'journey-transport-skateboard')
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'skateboard')
  expect(container.querySelector('.pet-transport-actor__sheet')).toHaveAttribute('src', '/assets/pets/transport/guigui-transport-v1.png')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  click(container, 'journey-save-transport')
  expect(storage.get(petTransportStorageKey(user, pet.id, ORIGINAL_COMPANION_SRC))).toEqual({ version: 1, appearance: ORIGINAL_COMPANION_SRC, vehicle: 'skateboard' })
  expect(Taro.eventCenter.trigger).toHaveBeenCalledWith(PET_TRANSPORT_CHANGED)
  expect(saved()).toEqual(ledger)
})

test('ordinary background/foreground freezes the same game instead of resetting the board or refetching the pet', async () => {
  const { container } = await mount()
  startMerge(container); click(container, 'merge-left')
  const steps = container.querySelector('#merge-board')!.getAttribute('data-steps')
  act(() => { hide?.() })
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-state', 'paused')
  expect(container.querySelector('#merge-resume')).toBeDisabled()
  act(() => { jest.advanceTimersByTime(60000) })
  await act(async () => { show?.(); await Promise.resolve() })
  expect(getPetSummary).toHaveBeenCalledTimes(1)
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-state', 'paused')
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-steps', steps)
  click(container, 'merge-resume'); click(container, 'merge-right')
  expect(Number(container.querySelector('#merge-board')!.getAttribute('data-steps'))).toBeGreaterThan(Number(steps))
})

test('an unfinished game with no pending result can recover account identity in place without another show event', async () => {
  const { container } = await mount()
  startMerge(container); click(container, 'merge-left')
  const steps = container.querySelector('#merge-board')!.getAttribute('data-steps')
  act(() => { hide?.() }); failIdentityReads = true
  await act(async () => { show?.(); await Promise.resolve() })
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-state', 'paused')
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-steps', steps)
  expect(container.querySelector('#merge-resume')).toBeDisabled()
  expect(container.querySelector('#merge-retry-settlement')).not.toBeInTheDocument()
  click(container, 'journey-recover-account')
  expect(container.querySelector('#merge-resume')).toBeDisabled()
  failIdentityReads = false; click(container, 'journey-recover-account')
  expect(container.querySelector('#journey-recover-account')).not.toBeInTheDocument()
  expect(container.querySelector('#merge-resume')).toBeEnabled()
  click(container, 'merge-resume'); click(container, 'merge-right')
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-state', 'running')
  expect(Number(container.querySelector('#merge-board')!.getAttribute('data-steps'))).toBeGreaterThan(Number(steps))
  expect(getPetSummary).toHaveBeenCalledTimes(1)
  expect(saved().rounds).toEqual([]); expect(saved().stars).toBe(0)
})

test.each(['adventure'] as const)('a legacy %s query opens the real game once and migrates the old wallet only once', async game => {
  const legacyKey = `pet_adventure_progress_v1:${user}:${pet.id}`
  const legacy = { ...createAdventureProgress(), starBalance: 45, xp: 85, inventory: ['plant'], clearedLevels: [1, 2], settledRoundIds: ['v1-already-saved'] }
  storage.set(legacyKey, clone(legacy))
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ options: { game } }])
  const { container, unmount } = await mount()
  expect(container.querySelector(`#${game}-start`)).toBeEnabled()
  expect(saved().stars).toBe(45)
  expect(saved().rounds).toEqual(['v1-already-saved'])
  expect(saved().pets[pet.id]).toMatchObject({ xp: 85, cleared: { adventure: [1, 2] } })
  click(container, 'adventure-exit')
  await act(async () => { show?.(); await Promise.resolve() })
  expect(screen.getByText('小麦的小屋')).toBeInTheDocument()
  expect(container.querySelector(`#${game}-start`)).not.toBeInTheDocument()
  unmount()
  const reopened = await mount()
  expect(reopened.container.querySelector(`#${game}-start`)).toBeEnabled()
  expect(saved().stars).toBe(45)
  expect(writes()).toHaveLength(1)
  expect(storage.get(legacyKey)).toEqual(legacy)
})

test('real merge input settles its measured score, collectibles and six-star-light reward once', async () => {
  const { container } = await mount()
  startMerge(container); finishMerge(container); await flush()
  expect(container.querySelector('#merge-result')).toHaveTextContent('420 游戏分')
  expect(saved().stars).toBe(6); expect(saved().daily.earned).toBe(6)
  expect(saved().pets[pet.id].bests['merge:1']).toEqual({ score: 420, stars: 3 })
  expect(saved().pets[pet.id].cleared.merge).toEqual([1])
  expect(saved().inventory).toContain('merge-tricolor-plate')
  expect(saved().rounds).toHaveLength(1)
  click(container, 'merge-result-exit')
  expect(screen.getByText('小麦的小屋')).toBeInTheDocument()
  expect(container.querySelector('.journey-wallet')).toHaveTextContent('✦ 6')
})

test.each(['kitchen', 'explore'])('removed %s queries and all entry surfaces cannot start a retired game', async game => {
  const legacyKey = `pet_adventure_progress_v1:${user}:${pet.id}`
  const legacy = { ...createAdventureProgress(), starBalance: 45, xp: 85, inventory: ['plant'], settledRoundIds: ['old-round'] }
  storage.set(legacyKey, clone(legacy))
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ options: { game } }])
  const { container, unmount } = await mount()
  expect(container.querySelector('#journey-play-now')).toBeEnabled()
  expect(container.querySelector(`#${game}-start`)).toBeNull()
  expect(container.querySelector(`#journey-feature-${game}`)).toBeNull()
  expect(container.querySelectorAll('.pet-play-lobby__choice')).toHaveLength(2)
  click(container, 'journey-tab-map')
  expect(container.querySelector(`#journey-map-${game}`)).toBeNull()
  expect(container.querySelector(`#journey-start-${game}`)).toBeNull()
  expect(container.querySelectorAll('.journey-game-card')).toHaveLength(2)
  click(container, 'journey-tab-collection')
  expect(container.querySelector(`#journey-badges-${game}`)).toBeNull()
  expect(container.querySelectorAll('.journey-milestone')).toHaveLength(3)
  expect(saved().stars).toBe(45); expect(saved().rounds).toEqual(['old-round'])
  expect(storage.get(legacyKey)).toEqual(legacy)
  unmount(); await mount()
  expect(saved().stars).toBe(45)
  expect(writes()).toHaveLength(1)
})

test('earned retired badges stay named and placeable, with six current badges and no retired wish prompt', async () => {
  const old = newGrowthSave(); old.migratedPets = [pet.id]
  const journey = old.pets[pet.id] = newPetJourney()
  journey.badges = ['kitchen-first']; journey.wish = 'kitchen-combo'
  old.inventory.push('badge:kitchen-first')
  storage.set(growthStorageKey(user), clone(old))
  const { container } = await mount()
  expect(container.querySelector('#journey-current-wish')).toHaveTextContent('6 枚技巧徽章')
  click(container, 'journey-tab-collection')
  expect(screen.getByText('技巧徽章 · 0/6')).toBeInTheDocument()
  const historical = container.querySelector('[id="journey-place-badge:kitchen-first"]')
  expect(historical).toHaveTextContent('第一份热饭')
  fireEvent.click(historical as Element)
  expect(saved().pets[pet.id].placements.window).toBe('badge:kitchen-first')
  expect(saved().pets[pet.id].wish).toBe('kitchen-combo')
  expect(saved().pets[pet.id].badges).toEqual(['kitchen-first'])
})

test('a genuinely failed played round keeps its progress reward and can restart without marking a clear', async () => {
  const { container } = await mount()
  startMerge(container)
  const directions = ['down', 'left', 'up', 'right']
  for (let turn = 0; turn < 160 && container.querySelector('#merge-board'); turn += 1) click(container, `merge-${directions[turn % 4]}`)
  await flush()
  expect(container.querySelector('#merge-result')).toHaveTextContent('我们下次再试试')
  expect(saved().stars).toBe(6); expect(saved().pets[pet.id].cleared.merge).toEqual([])
  expect(saved().inventory).not.toContain('merge-tricolor-plate')
  const roundId = saved().rounds[0]
  click(container, 'merge-retry')
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-steps', '0')
  expect(container.querySelector('#merge-board')).toHaveAttribute('data-state', 'running')
  expect(saved().rounds).toEqual([roundId])
})

test('failed settlement blocks leaving or reopening and retry commits the same round ID and actual result', async () => {
  const { container } = await mount()
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  startMerge(container); failGrowthWrites = true; finishMerge(container); await flush()
  expect(container.querySelector('#merge-retry-settlement')).toBeEnabled()
  expect(saved().stars).toBe(0); expect(saved().rounds).toEqual([])
  const attempted = writes()[0]
  expect(attempted.rounds).toHaveLength(1)
  for (const id of ['merge-back', 'merge-retry', 'merge-result-exit', 'merge-menu']) {
    expect(container.querySelector(`#${id}`)).toBeDisabled(); click(container, id)
  }
  expect(writes()).toHaveLength(1)
  expect(container.querySelector('#merge-result')).toHaveTextContent('420 游戏分')
  failGrowthWrites = false; click(container, 'merge-retry-settlement'); await flush()
  expect(writes()).toHaveLength(2)
  expect(writes()[1]).toEqual(attempted)
  expect(saved().rounds).toEqual(attempted.rounds); expect(saved().stars).toBe(6)
  expect(container.querySelector('#merge-result-exit')).toBeEnabled()
  click(container, 'merge-result-exit')
  expect(screen.getByText('小麦的小屋')).toBeInTheDocument()
})

test('temporarily unreadable account identity retains the finished round for retry rather than treating it as saved', async () => {
  const { container } = await mount()
  startMerge(container); failIdentityReads = true; finishMerge(container); await flush()
  expect(container.querySelector('#merge-retry-settlement')).toBeInTheDocument()
  expect(container.querySelector('#merge-result-exit')).toBeDisabled()
  expect(saved().stars).toBe(0); expect(saved().rounds).toEqual([])
  act(() => { hide?.() })
  await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve() })
  expect(getPetSummary).toHaveBeenCalledTimes(1)
  expect(container.querySelector('#merge-retry-settlement')).toBeInTheDocument()
  expect(container.querySelector('#merge-result-exit')).toBeDisabled()
  failIdentityReads = false
  click(container, 'journey-recover-account')
  click(container, 'merge-retry-settlement'); await flush()
  expect(saved().stars).toBe(6); expect(saved().rounds).toHaveLength(1)
  expect(container.querySelector('#merge-result-exit')).toBeEnabled()
})

test('backgrounding before the queued completion callback defers settlement until return and saves only once', async () => {
  const { container } = await mount()
  startMerge(container); finishMerge(container)
  act(() => { hide?.() })
  await flush()
  expect(saved().rounds).toEqual([])
  await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  expect(saved().stars).toBe(6); expect(saved().rounds).toHaveLength(1)
  expect(container.querySelector('#merge-result-exit')).toBeEnabled()
})

test('production-sized UUID account and pet IDs do not make a legitimate completed round unsaveable', async () => {
  const account = '11111111-1111-4111-8111-111111111111'
  const petId = '22222222-2222-4222-8222-222222222222'
  storage.set('user_id', account); storage.set(preferenceKey(account), { selected: 'original', enabledOriginal: true })
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { ...pet, id: petId } })
  const { container } = await mount()
  startMerge(container); finishMerge(container); await flush()
  expect(saved(account).stars).toBe(6)
  expect(saved(account).rounds).toHaveLength(1)
  expect(saved(account).rounds[0].length).toBeLessThanOrEqual(128)
  expect(container.querySelector('#merge-result-exit')).toBeEnabled()
})

test('unmount cancels a late profile response without migrating the detached pet', async () => {
  const response = deferred<{ pet: PetProfile }>()
  ;(getPetSummary as jest.Mock).mockReturnValueOnce(response.promise)
  const { unmount } = await mount()
  unmount()
  await act(async () => { response.resolve({ pet }); await Promise.resolve(); await Promise.resolve() })
  expect(storage.has(growthStorageKey(user))).toBe(false)
  expect(jest.getTimerCount()).toBe(0)
})

test('unmounting a running adventure removes its timer and never settles the detached game', async () => {
  const { container, unmount } = await mount()
  click(container, 'journey-tab-map'); click(container, 'journey-start-adventure'); click(container, 'adventure-start')
  expect(container.querySelector('#adventure-world')).toHaveAttribute('data-state', 'running')
  expect(jest.getTimerCount()).toBeGreaterThan(0)
  unmount()
  expect(jest.getTimerCount()).toBe(0)
  act(() => { jest.advanceTimersByTime(120000) }); await flush()
  expect(saved().rounds).toEqual([]); expect(saved().stars).toBe(0)
})

it('tracks a chosen badge, earns it through actual merge inputs and displays it at home', async () => {
  const { container } = await mount()
  click(container, 'journey-wishes-open'); click(container, 'journey-badges-merge'); click(container, 'journey-wish-merge-first')
  expect(saved().pets[pet.id].wish).toBe('merge-first')
  startMerge(container); finishMerge(container); await flush()
  expect(saved().pets[pet.id].badges).toContain('merge-first')
  click(container, 'merge-result-exit')
  expect(container.querySelector('#journey-current-wish')?.textContent).toContain('心愿达成')
  click(container, 'journey-tab-collection')
  const place = container.querySelector('[id="journey-place-badge:merge-first"]')
  expect(place).not.toBeNull(); fireEvent.click(place as Element)
  expect(saved().pets[pet.id].placements.window).toBe('badge:merge-first')
  click(container, 'journey-tab-home')
  expect(container.querySelector('.journey-room__prop')?.textContent).toContain('配方初成')
})

it('does not show an unsaved wish as selected', async () => {
  const { container } = await mount()
  click(container, 'journey-wishes-open'); failGrowthWrites = true
  click(container, 'journey-wish-adventure-stars')
  expect(saved().pets[pet.id].wish).toBeNull()
  expect(container.querySelector('#journey-wish-adventure-stars')?.textContent).toBe('设为心愿')
})

it('offers a non-spending merge suggestion and clears it after a player decision', async () => {
  const { container } = await mount(); startMerge(container)
  const before = saved()
  click(container, 'merge-hint')
  expect(container.querySelector('#merge-hint-message')?.textContent).toContain('三色早餐')
  expect(container.querySelector('#merge-board')?.getAttribute('data-steps')).toBe('0')
  expect(saved()).toEqual(before)
  click(container, 'merge-hint-recipe')
  expect(container.querySelector('#merge-hint-message')).toBeNull()
  expect(container.querySelector('#merge-recipe-breakfast')?.className).toContain('selected')
})
