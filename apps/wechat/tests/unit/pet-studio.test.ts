import Taro from '@tarojs/taro'
import { availableStudioActions, buildStudioCharacters, canTryStudioScarf, rhythmPoints, readStudioScarf, saveStudioScarf } from '../../src/utils/pet-studio'
import { ORIGINAL_COMPANION_SRC } from '../../src/utils/pet-companion-preference'
import type { PetProfile } from '../../src/utils/api'

const pet = { id: 'pet-1', name: '鬼鬼', builtin_avatar_id: 'jianwen-01', selection_candidates: [{ id: 'wheat', name: '小麦', builtin_avatar_id: 'xiaomai-01' }] } as PetProfile
beforeEach(() => { jest.clearAllMocks() })
test('the approved account sprite remains distinct from template previews', () => {
  const [current, template] = buildStudioCharacters(pet, { enabledOriginal: true, selected: 'original' })
  expect(current.sprite).toBe(ORIGINAL_COMPANION_SRC)
  expect(current.name).toBe('鬼鬼')
  expect(template.pet.builtin_avatar_id).toBe('xiaomai-01')
  expect(template.sprite).toBeUndefined()
  expect(canTryStudioScarf(template)).toBe(false)
})
test('photo pets never borrow another character motion or scarf', () => {
  const [photo] = buildStudioCharacters({ ...pet, builtin_avatar_id: '', pixel_avatar_url: 'https://example.com/my-pet.png' }, { enabledOriginal: false, selected: 'follow' })
  expect(availableStudioActions(photo)).toEqual(['idle'])
  expect(canTryStudioScarf(photo)).toBe(false)
  photo.pet.pixel_avatar_squash_url = 'squash.png'; photo.pet.pixel_avatar_jump_url = 'jump.png'
  expect(availableStudioActions(photo)).toEqual(['idle', 'hop'])
})
test('dressing writes are account scoped and unsupported bodies cannot equip scarf', () => {
  const storage: Record<string, unknown> = { user_id: 'user-one' }
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage[key])
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => { storage[key] = value })
  const [current, template] = buildStudioCharacters(pet, { enabledOriginal: true, selected: 'original' })
  expect(saveStudioScarf(template, true)).toBe(false)
  expect(saveStudioScarf(current, true)).toBe(true)
  expect(readStudioScarf(current)).toBe(true)
  storage.user_id = 'user-two'
  expect(readStudioScarf(current)).toBe(false)
})
test('practice rewards accuracy rather than arbitrary taps', () => {
  expect(rhythmPoints(50)).toBe(10)
  expect(rhythmPoints(65)).toBe(5)
  expect(rhythmPoints(95)).toBe(0)
})
