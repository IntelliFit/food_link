import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetStudioPage from '../../src/packagePetStudio/pages/index/index'
import { getPetSummary, type PetProfile } from '../../src/utils/api'
import { GROWTH_CHAPTERS, buyGrowthItem, newGrowthSave, newPetJourney, settleGrowthRound, type GrowthGame, type GrowthSave } from '../../src/utils/pet-growth'
import { GROWTH_CHANGED, growthStorageKey, readGrowth, writeGrowth } from '../../src/utils/pet-growth-storage'
import { HOME_COMPANION_PREFERENCE_KEY, ORIGINAL_COMPANION_SRC } from '../../src/utils/pet-companion-preference'
import { HOME_PET_PROFILE_CHANGED_EVENT } from '../../src/utils/pet-events'
import { PET_LOADOUT_CHANGED, readPetLoadout } from '../../src/utils/pet-loadout'
import { extraPkgUrl } from '../../src/utils/subpackage-extra'
import { createAdventureProgress } from '../../src/utils/pet-adventure-progress'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/utils/api', () => ({ getPetSummary: jest.fn() }))
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
    ['kitchen', 1, { served: 2 }], ['explore', 1, { moves: 4, nodes: 3 }],
    ['explore', 2, { moves: 5, nodes: 3 }], ['merge', 1, { steps: 4 }],
    ['kitchen', 2, { served: 2 }], ['adventure', 2, { distance: 300 }],
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
  expect(screen.getByTestId('hub-pet')).toHaveAttribute('data-active', 'true')
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
  ['kitchen', 'kitchen-prepare', '离开餐车'],
  ['merge', 'merge-board', 'merge-exit'],
  ['adventure', 'adventure-world', 'adventure-exit'],
  ['explore', 'explore-world', 'explore-paused-exit'],
] as const)('%s map pin and card both open a playable game; leaving an unfinished game gives no reward', async (game, world, exit) => {
  const { container, unmount } = await mount()
  for (const entry of ['journey-map-', 'journey-start-']) {
    click(container, 'journey-tab-map'); click(container, `${entry}${game}`)
    expect(container.querySelector(`#${game}-start`)).toBeEnabled()
    expect(screen.getAllByTestId('hub-pet')[0]).toHaveAttribute('data-pet-id', pet.id)
    click(container, `${game}-start`)
    expect(container.querySelector(`#${world}`)).toBeInTheDocument()
    if (game !== 'kitchen') expect(container.querySelector(`#${world}`)).toHaveAttribute('data-state', 'running')
    click(container, `${game}-back`)
    if (game === 'kitchen') fireEvent.click(screen.getByRole('button', { name: exit }))
    else click(container, exit)
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

test.each(['landmarks', 'kitchen', 'placement'] as const)('the first chapter cannot be selected when its %s condition is missing', async missing => {
  const next = seedChapterPrerequisites()
  next.pets[pet.id].placements.window = 'journey-card'
  if (missing === 'landmarks') { next.pets[pet.id].seenLandmarks = ['explore:1:clue', 'explore:1:canal']; next.pets[pet.id].landmarks = 2 }
  if (missing === 'kitchen') next.pets[pet.id].cleared.kitchen = []
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
  expect(screen.getByTestId('hub-pet')).toHaveAttribute('data-scarf', 'cozy-scarf')
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
  expect(screen.getByTestId('hub-pet')).toHaveAttribute('data-scarf', '')
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
  expect(screen.getByTestId('hub-pet')).toHaveTextContent('小松')
  expect(screen.getByTestId('hub-pet')).toHaveAttribute('data-scarf', '')
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
  expect(screen.getByTestId('hub-pet')).toHaveTextContent('换了名字的小麦')
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

test.each(['adventure', 'kitchen'] as const)('a legacy %s query opens the real game once and migrates the old wallet only once', async game => {
  const legacyKey = `pet_adventure_progress_v1:${user}:${pet.id}`
  const legacy = { ...createAdventureProgress(), starBalance: 45, xp: 85, inventory: ['plant'], clearedLevels: [1, 2], settledRoundIds: ['v1-already-saved'] }
  storage.set(legacyKey, clone(legacy))
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ options: { game } }])
  const { container, unmount } = await mount()
  expect(container.querySelector(`#${game}-start`)).toBeEnabled()
  expect(saved().stars).toBe(45)
  expect(saved().rounds).toEqual(['v1-already-saved'])
  expect(saved().pets[pet.id]).toMatchObject({ xp: 85, cleared: { adventure: [1, 2] } })
  click(container, `${game}-back`)
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

test('real water node sources remain unique through continuation, exit and reopening the same route', async () => {
  const { container, unmount } = await mount()
  click(container, 'journey-tab-map'); click(container, 'journey-start-explore'); click(container, 'explore-start')
  click(container, 'explore-node-clue'); click(container, 'explore-observe')
  click(container, 'explore-node-camp'); click(container, 'explore-finish'); await flush()
  expect(container.querySelector('#explore-result')).toHaveAttribute('data-score', '50')
  expect(container.querySelector('#explore-result')).toHaveAttribute('data-completed', 'false')
  expect(saved().stars).toBe(6); expect(saved().pets[pet.id].landmarks).toBe(1)
  expect(saved().pets[pet.id].seenLandmarks).toEqual(['explore:1:clue'])
  expect(saved().pets[pet.id].bests['explore:1']).toEqual({ score: 50, stars: 0 })
  expect(saved().pets[pet.id].cleared.explore).toEqual([])
  click(container, 'explore-continue')
  click(container, 'explore-node-clue'); click(container, 'explore-observe')
  expect(container.querySelector('#explore-world')).toHaveAttribute('data-score', '0')
  click(container, 'explore-node-camp'); click(container, 'explore-finish'); await flush()
  expect(saved().stars).toBe(6); expect(saved().pets[pet.id].landmarks).toBe(1)
  expect(saved().rounds).toHaveLength(2)
  click(container, 'explore-result-exit')
  expect(screen.getByText('小麦的小屋')).toBeInTheDocument()
  click(container, 'journey-tab-map'); click(container, 'journey-start-explore'); click(container, 'explore-start')
  click(container, 'explore-node-clue'); click(container, 'explore-observe')
  expect(container.querySelector('#explore-world')).toHaveAttribute('data-score', '50')
  click(container, 'explore-node-camp'); click(container, 'explore-finish'); await flush()
  expect(saved().rounds).toHaveLength(3)
  expect(saved().stars).toBe(6)
  expect(saved().pets[pet.id].landmarks).toBe(1)
  expect(saved().pets[pet.id].seenLandmarks).toEqual(['explore:1:clue'])
  unmount(); await mount()
  expect(screen.getByText('水岸地标 1/3')).toBeInTheDocument()
  expect(saved().pets[pet.id].seenLandmarks).toEqual(['explore:1:clue'])
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
  click(container, 'journey-wish-kitchen-combo')
  expect(saved().pets[pet.id].wish).toBeNull()
  expect(container.querySelector('#journey-wish-kitchen-combo')?.textContent).toBe('设为心愿')
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
