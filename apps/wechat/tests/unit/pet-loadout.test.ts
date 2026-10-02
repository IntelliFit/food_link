import Taro from '@tarojs/taro'
import { PET_LOADOUT_CHANGED, readPetLoadout, savePetLoadout } from '../../src/utils/pet-loadout'
import { JIANWEN_COMPANION_SRC, ORIGINAL_COMPANION_SRC } from '../../src/utils/pet-companion-preference'

const accountA = 'account-a'
const accountB = 'account-b'
const petA = 'pet-a'
const petB = 'pet-b'
const photo = 'https://example.test/pets/my-pet.png?v=2'
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const key = (account: string, pet: string, appearance: string) => `pet_loadout_v2:${account}:${pet}:${encodeURIComponent(appearance)}`
const legacyKey = (account: string, pet: string) => `pet_adventure_progress_v1:${account}:${pet}`
let store: Map<string, unknown>

beforeEach(() => {
  jest.clearAllMocks()
  store = new Map([['user_id', accountA]])
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((storageKey: string) => store.has(storageKey) ? copy(store.get(storageKey)) : undefined)
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((storageKey: string, value: unknown) => { store.set(storageKey, copy(value)) })
})

test('a new appearance reads an unequipped loadout without silently writing or deleting old data', () => {
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)).toEqual({ version: 2, appearance: ORIGINAL_COMPANION_SRC, scarf: null })
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(Taro.removeStorageSync).not.toHaveBeenCalled()
})

test('a compatible outfit saves under the exact account, pet and encoded appearance and emits one refresh event', () => {
  expect(savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'cozy-scarf', accountA)).toBe(true)
  expect(store.get(key(accountA, petA, ORIGINAL_COMPANION_SRC))).toEqual({ version: 2, appearance: ORIGINAL_COMPANION_SRC, scarf: 'cozy-scarf' })
  expect(Taro.eventCenter.trigger).toHaveBeenCalledTimes(1)
  expect(Taro.eventCenter.trigger).toHaveBeenCalledWith(PET_LOADOUT_CHANGED)
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('cozy-scarf')
  expect(savePetLoadout(petA, ORIGINAL_COMPANION_SRC, null, accountA)).toBe(true)
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBeNull()
})

test.each([JIANWEN_COMPANION_SRC, photo])('unsupported appearance %s cannot receive another character clothing', appearance => {
  expect(savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'explorer-scarf', accountA)).toBe(true)
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  ;(Taro.eventCenter.trigger as jest.Mock).mockClear()
  expect(savePetLoadout(petA, appearance, 'explorer-scarf', accountA)).toBe(false)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
  expect(readPetLoadout(petA, appearance)).toEqual({ version: 2, appearance, scarf: null })
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('explorer-scarf')
  expect(savePetLoadout(petA, appearance, null, accountA)).toBe(true)
  expect(store.get(key(accountA, petA, appearance))).toEqual({ version: 2, appearance, scarf: null })
})

test('even a tampered stored scarf is hidden on an incompatible appearance without erasing the saved record', () => {
  const stored = { version: 2, appearance: photo, scarf: 'explorer-scarf' }
  store.set(key(accountA, petA, photo), stored)
  expect(readPetLoadout(petA, photo)).toEqual({ version: 2, appearance: photo, scarf: null })
  expect(store.get(key(accountA, petA, photo))).toEqual(stored)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('different pets and appearances retain their own equipment, with no visual substitution', () => {
  savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'cozy-scarf', accountA)
  savePetLoadout(petB, ORIGINAL_COMPANION_SRC, 'explorer-scarf', accountA)
  savePetLoadout(petA, photo, null, accountA)
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('cozy-scarf')
  expect(readPetLoadout(petB, ORIGINAL_COMPANION_SRC)?.scarf).toBe('explorer-scarf')
  expect(readPetLoadout(petA, photo)).toEqual({ version: 2, appearance: photo, scarf: null })
})

test('an account switch rejects the old page write and cannot read or change the original account outfit', () => {
  savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'cozy-scarf', accountA)
  const savedA = copy(store.get(key(accountA, petA, ORIGINAL_COMPANION_SRC)))
  store.set('user_id', accountB)
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  ;(Taro.eventCenter.trigger as jest.Mock).mockClear()
  expect(savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'explorer-scarf', accountA)).toBe(false)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBeNull()
  expect(savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'explorer-scarf', accountB)).toBe(true)
  expect(store.get(key(accountA, petA, ORIGINAL_COMPANION_SRC))).toEqual(savedA)
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('explorer-scarf')
  store.set('user_id', accountA)
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('cozy-scarf')
})

test('a failed equipment write retains the previous v2 outfit and legacy recovery record, and emits no success event', () => {
  const legacy = { version: 1, equipment: { scarf: 'explorer-scarf' } }
  store.set(legacyKey(accountA, petA), copy(legacy))
  savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'cozy-scarf', accountA)
  const old = copy(store.get(key(accountA, petA, ORIGINAL_COMPANION_SRC)))
  ;(Taro.eventCenter.trigger as jest.Mock).mockClear()
  ;(Taro.setStorageSync as jest.Mock).mockImplementationOnce(() => { throw new Error('quota exceeded') })
  expect(savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'explorer-scarf', accountA)).toBe(false)
  expect(store.get(key(accountA, petA, ORIGINAL_COMPANION_SRC))).toEqual(old)
  expect(store.get(legacyKey(accountA, petA))).toEqual(legacy)
  expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
  expect(Taro.removeStorageSync).not.toHaveBeenCalled()
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('cozy-scarf')
})

test('legacy equipment can be read repeatedly without importing writes, and current v2 takes precedence', () => {
  const legacy = { version: 1, inventory: ['explorer-scarf'], equipment: { scarf: 'explorer-scarf' } }
  store.set(legacyKey(accountA, petA), copy(legacy))
  store.set(`pet_studio_dressing_v1:${accountA}:${encodeURIComponent(ORIGINAL_COMPANION_SRC)}`, 'scarf')
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('explorer-scarf')
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('explorer-scarf')
  expect(readPetLoadout(petA, JIANWEN_COMPANION_SRC)?.scarf).toBeNull()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(Taro.removeStorageSync).not.toHaveBeenCalled()
  expect(store.get(legacyKey(accountA, petA))).toEqual(legacy)
  savePetLoadout(petA, ORIGINAL_COMPANION_SRC, null, accountA)
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBeNull()
})

test('a refresh subscriber error does not report a persisted outfit as an unsuccessful save', () => {
  savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'cozy-scarf', accountA)
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementationOnce(() => { throw new Error('subscriber failed') })
  expect(savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'explorer-scarf', accountA)).toBe(true)
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('explorer-scarf')
})

test('legacy trial clothing is account and appearance scoped and never copied onto a photo', () => {
  store.set(`pet_studio_dressing_v1:${accountA}:${encodeURIComponent(ORIGINAL_COMPANION_SRC)}`, 'scarf')
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBe('cozy-scarf')
  expect(readPetLoadout(petA, photo)?.scarf).toBeNull()
  store.set('user_id', accountB)
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)?.scarf).toBeNull()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})

test('read errors and missing account or pet do not create anonymous or empty-key outfits', () => {
  ;(Taro.getStorageSync as jest.Mock).mockImplementationOnce(() => { throw new Error('read unavailable') })
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)).toBeNull()
  store.set('user_id', '')
  expect(readPetLoadout(petA, ORIGINAL_COMPANION_SRC)).toBeNull()
  expect(savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'cozy-scarf', accountA)).toBe(false)
  expect(savePetLoadout(petA, ORIGINAL_COMPANION_SRC, 'cozy-scarf', '')).toBe(false)
  store.set('user_id', accountA)
  expect(readPetLoadout('', ORIGINAL_COMPANION_SRC)).toBeNull()
  expect(savePetLoadout('', ORIGINAL_COMPANION_SRC, 'cozy-scarf', accountA)).toBe(false)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})
