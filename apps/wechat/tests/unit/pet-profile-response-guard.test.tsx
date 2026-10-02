import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetHomePage from '../../src/packageExtra/pages/pet-home/index'
import { customizePetPixelAvatar, getPetSummary, selectPetAppearance, type PetProfile } from '../../src/utils/api'
import { chooseImageWithPrivacy } from '../../src/utils/weapp-privacy'
import { HOME_COMPANION_PREFERENCE_KEY } from '../../src/utils/pet-companion-preference'
import { HOME_PET_PROFILE_CHANGED_EVENT } from '../../src/utils/pet-events'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/utils/api', () => ({
  getPetSummary: jest.fn(), customizePetPixelAvatar: jest.fn(), selectPetAppearance: jest.fn(),
  claimPetEvent: jest.fn(), updatePetName: jest.fn(), showUnifiedApiError: jest.fn(),
}))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/components/PetAvatar', () => ({ PetAvatar: ({ pet }: { pet?: PetProfile }) => <span data-testid='candidate-avatar'>{pet?.name}</span> }))
jest.mock('../../src/components/PetIdentityAvatar', () => ({ PetIdentityAvatar: ({ pet }: { pet?: PetProfile }) => <span data-testid='profile-avatar'>{pet?.name || 'loading'}</span> }))
jest.mock('../../src/utils/weapp-privacy', () => ({ chooseImageWithPrivacy: jest.fn(), isPrivacyAuthorizeError: jest.fn(() => false), showPrivacyAuthorizeFailure: jest.fn() }))

const userA = 'account-a'
const userB = 'account-b'
const candidate = { id: 'template-a', name: '模板小麦', builtin_avatar_id: 'xiaomai-01' }
const petA = { id: 'pet-a', name: '伙伴甲', builtin_avatar_id: 'jianwen-01', selection_candidates: [candidate] } as PetProfile
const petB = { ...petA, id: 'pet-b', name: '伙伴乙' } as PetProfile
const preferenceKey = (user: string) => `${HOME_COMPANION_PREFERENCE_KEY}:${user}`
let store: Map<string, any>
let show: (() => void) | undefined
let pull: (() => void) | undefined
const copy = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function flush() { await act(async () => { for (let step = 0; step < 6; step += 1) await Promise.resolve() }) }
async function mount() { const result = render(<PetHomePage />); await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve() }); return result }
function chooseTemplate(container: HTMLElement) { fireEvent.click(container.querySelector('.pet-home-candidate-grid--common .pet-home-candidate-card')!) }
function profileEvents() { return (Taro.eventCenter.trigger as jest.Mock).mock.calls.filter(([event]) => event === HOME_PET_PROFILE_CHANGED_EVENT) }
async function switchToB() { store.set('user_id', userB); (getPetSummary as jest.Mock).mockResolvedValue({ pet: petB }); await act(async () => { show?.(); await Promise.resolve(); await Promise.resolve() }) }

beforeEach(() => {
  jest.clearAllMocks(); show = undefined; pull = undefined
  ;[getPetSummary, customizePetPixelAvatar, selectPetAppearance, chooseImageWithPrivacy, Taro.showModal].forEach(mock => (mock as jest.Mock).mockReset())
  store = new Map<string, any>([
    ['user_id', userA],
    [preferenceKey(userA), { selected: 'original', enabledOriginal: true }],
    [preferenceKey(userB), { selected: 'jianwen', enabledOriginal: true }],
  ])
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => { show = callback })
  ;(Taro.usePullDownRefresh as jest.Mock).mockImplementation(callback => { pull = callback })
  Taro.stopPullDownRefresh = jest.fn().mockResolvedValue(undefined)
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => copy(store.get(key) || ''))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => store.set(key, copy(value)))
  ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true, content: '照片伙伴' })
  ;(chooseImageWithPrivacy as jest.Mock).mockResolvedValue({ tempFilePaths: ['wxfile://owned-photo.jpg'] })
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: petA })
})

test('a late template response cannot change the next account preference or publish the previous pet', async () => {
  const response = deferred<{ pet: PetProfile }>()
  ;(selectPetAppearance as jest.Mock).mockReturnValueOnce(response.promise)
  const { container } = await mount()
  chooseTemplate(container)
  expect(selectPetAppearance).toHaveBeenCalledWith(candidate.id)
  await switchToB()
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  await act(async () => { response.resolve({ pet: { ...petA, name: '迟到的模板甲' } }); await Promise.resolve(); await Promise.resolve() })
  expect(screen.getByTestId('profile-avatar')).toHaveTextContent('伙伴乙')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(store.get(preferenceKey(userB))).toEqual({ selected: 'jianwen', enabledOriginal: true })
  expect(profileEvents()).toEqual([])
})

test('a photo generated for the previous account cannot change follow mode or open its preview after switching', async () => {
  const response = deferred<{ pet: PetProfile }>()
  ;(customizePetPixelAvatar as jest.Mock).mockReturnValueOnce(response.promise)
  const { container } = await mount()
  fireEvent.click(screen.getByText('专属像素分身')); await flush()
  expect(customizePetPixelAvatar).toHaveBeenCalledWith('wxfile://owned-photo.jpg', '照片伙伴')
  await switchToB()
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  await act(async () => { response.resolve({ pet: { ...petA, name: '迟到的照片甲', builtin_avatar_id: '', pixel_avatar_url: 'https://example.com/a.png' } }); await Promise.resolve() })
  expect(screen.getByTestId('profile-avatar')).toHaveTextContent('伙伴乙')
  expect(container.querySelector('.pet-pixel-preview-modal')).toBeNull()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(profileEvents()).toEqual([])
})

test('switching accounts while the naming dialog is open prevents starting a photo API for the new owner', async () => {
  const naming = deferred<{ confirm: boolean; content: string }>()
  ;(Taro.showModal as jest.Mock).mockReturnValueOnce(naming.promise)
  await mount(); fireEvent.click(screen.getByText('专属像素分身'))
  await switchToB()
  await act(async () => { naming.resolve({ confirm: true, content: '旧账号名字' }); await Promise.resolve() })
  expect(chooseImageWithPrivacy).not.toHaveBeenCalled()
  expect(customizePetPixelAvatar).not.toHaveBeenCalled()
  expect(profileEvents()).toEqual([])
})

test.each(['template', 'photo'] as const)('unmounting before a %s response prevents preference writes and profile events', async operation => {
  const response = deferred<{ pet: PetProfile }>()
  ;(selectPetAppearance as jest.Mock).mockReturnValueOnce(response.promise)
  ;(customizePetPixelAvatar as jest.Mock).mockReturnValueOnce(response.promise)
  const { container, unmount } = await mount()
  if (operation === 'template') chooseTemplate(container)
  else { fireEvent.click(screen.getByText('专属像素分身')); await flush() }
  unmount(); (Taro.setStorageSync as jest.Mock).mockClear()
  await act(async () => { response.resolve({ pet: petA }); await Promise.resolve() })
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(profileEvents()).toEqual([])
})

test('same-account template selection still calls the real API contract, follows the chosen appearance and publishes once', async () => {
  const selected = { ...petA, name: '已选小麦', builtin_avatar_id: 'xiaomai-01' }
  ;(selectPetAppearance as jest.Mock).mockResolvedValueOnce({ pet: selected })
  const { container } = await mount(); chooseTemplate(container); await flush()
  expect(selectPetAppearance).toHaveBeenCalledWith(candidate.id)
  expect(store.get(preferenceKey(userA))).toEqual({ selected: 'follow', enabledOriginal: true })
  expect(screen.getByTestId('profile-avatar')).toHaveTextContent('已选小麦')
  expect(profileEvents()).toEqual([[HOME_PET_PROFILE_CHANGED_EVENT, selected]])
})

test('camera return in the same account keeps the photo request valid and a stale summary cannot replace the new photo', async () => {
  const image = deferred<{ tempFilePaths: string[] }>()
  const oldSummary = deferred<{ pet: PetProfile }>()
  ;(chooseImageWithPrivacy as jest.Mock).mockReturnValueOnce(image.promise)
  const generated = { ...petA, name: '照片伙伴', builtin_avatar_id: '', pixel_avatar_url: 'https://example.com/owned.png' }
  ;(customizePetPixelAvatar as jest.Mock).mockResolvedValueOnce({ pet: generated })
  const { container } = await mount()
  fireEvent.click(screen.getByText('专属像素分身')); await flush()
  ;(getPetSummary as jest.Mock).mockReturnValueOnce(oldSummary.promise)
  act(() => { show?.() })
  await act(async () => { image.resolve({ tempFilePaths: ['wxfile://owned-photo.jpg'] }); await Promise.resolve(); await Promise.resolve() })
  await flush()
  expect(customizePetPixelAvatar).toHaveBeenCalledWith('wxfile://owned-photo.jpg', '照片伙伴')
  expect(container.querySelector('.pet-pixel-preview-modal')).toBeInTheDocument()
  expect(store.get(preferenceKey(userA)).selected).toBe('follow')
  await act(async () => { oldSummary.resolve({ pet: petA }); await Promise.resolve() })
  expect(screen.getByTestId('profile-avatar')).toHaveTextContent('照片伙伴')
  expect(profileEvents()).toEqual([[HOME_PET_PROFILE_CHANGED_EVENT, generated]])
})

test('out-of-order summaries and an unmounted page cannot apply their older profiles', async () => {
  const first = deferred<{ pet: PetProfile }>()
  const last = deferred<{ pet: PetProfile }>()
  ;(getPetSummary as jest.Mock).mockReturnValueOnce(first.promise).mockResolvedValueOnce({ pet: { ...petA, name: '最新档案' } }).mockReturnValueOnce(last.promise)
  const { unmount } = await mount()
  await act(async () => { pull?.(); await Promise.resolve() })
  await act(async () => { first.resolve({ pet: petA }); await Promise.resolve() })
  expect(screen.getByTestId('profile-avatar')).toHaveTextContent('最新档案')
  act(() => { pull?.() }); unmount()
  await act(async () => { last.resolve({ pet: petA }); await Promise.resolve() })
  expect(profileEvents()).toEqual([])
})
