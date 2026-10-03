import { fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import type { PetProfile } from '../../src/utils/api'
import { PetTransportActor } from '../../src/components/PetTransportActor'
import { PetTransportPicker } from '../../src/packagePetStudio/components/PetTransportPicker'
import { defaultPetTransport, petTransportAsset, petTransportCapabilities } from '../../src/utils/pet-transport'
import { PET_TRANSPORT_CHANGED, petTransportStorageKey, readPetTransport, savePetTransport } from '../../src/utils/pet-transport-storage'
import { ORIGINAL_COMPANION_SRC } from '../../src/utils/pet-companion-preference'

const pet = { id: 'p', name: '鬼鬼', builtin_avatar_id: 'jianwen-01' } as PetProfile
const photo = { id: 'photo', name: '我的照片伙伴', pixel_avatar_url: 'my-photo.png', pixel_motion_version: 1, pixel_motion_atlas_url: 'my-photo-atlas.png' } as PetProfile
let storage: Map<string, unknown>
beforeEach(() => {
  jest.clearAllMocks()
  storage = new Map([['user_id', 'a']])
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
})

test.each([['jianwen-01', 'jianwen'], ['huatuo-01', 'huatuo'], ['taiji-xiaozi-01', 'taiji'], ['xiaomai-01', 'xiaomai'], ['doudou-01', 'doudou']])('each builtin uses its own transport sheet: %s', (builtin, key) => {
  const identity = { ...pet, builtin_avatar_id: builtin }
  expect(petTransportCapabilities(identity)).toEqual(['bicycle', 'scooter', 'skateboard', 'walk'])
  expect(petTransportAsset(identity)).toBe(`/assets/pets/transport/${key}-transport-v1.png`)
  const { container } = render(<PetTransportActor pet={identity} vehicle='skateboard' />)
  expect(container.querySelector('img')).toHaveAttribute('src', `/assets/pets/transport/${key}-transport-v1.png`)
})
test('the approved original override keeps Guigui instead of the cloud template', () => {
  expect(petTransportAsset(pet, ORIGINAL_COMPANION_SRC)).toBe('/assets/pets/transport/guigui-transport-v1.png')
  expect(defaultPetTransport(pet, ORIGINAL_COMPANION_SRC)).toBe('bicycle')
})
test('a photo v1 atlas never unlocks borrowed transport or rewrites its identity', () => {
  expect(petTransportCapabilities(photo)).toEqual(['walk'])
  expect(savePetTransport(photo, undefined, 'skateboard', 'a')).toBe(false)
  const { container } = render(<PetTransportActor pet={photo} vehicle='scooter' showStatus />)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'walk')
  expect(container.querySelector('img')).toHaveAttribute('src', 'my-photo-atlas.png')
  expect(container.querySelector('.pet-assistant-ride')).toBeNull()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})
test('transport preferences isolate account, pet and exact appearance without touching wardrobe or wallet', () => {
  storage.set('pet_growth_v2:a', { stars: 79 })
  storage.set('pet_loadout_v2:a:p', { scarf: 'cozy-scarf' })
  const before = new Map(storage)
  expect(savePetTransport(pet, ORIGINAL_COMPANION_SRC, 'scooter', 'a')).toBe(true)
  expect(readPetTransport('p', ORIGINAL_COMPANION_SRC, 'bicycle')?.vehicle).toBe('scooter')
  expect(readPetTransport('other-pet', ORIGINAL_COMPANION_SRC, 'bicycle')?.vehicle).toBe('bicycle')
  expect(readPetTransport('p', 'jianwen-01', 'bicycle')?.vehicle).toBe('bicycle')
  for (const [key, value] of before) expect(storage.get(key)).toEqual(value)
  expect(Taro.setStorageSync).toHaveBeenCalledTimes(1)
  expect(Taro.eventCenter.trigger).toHaveBeenCalledWith(PET_TRANSPORT_CHANGED)
  storage.set('user_id', 'b')
  expect(readPetTransport('p', ORIGINAL_COMPANION_SRC, 'bicycle')?.vehicle).toBe('bicycle')
  expect(savePetTransport(pet, ORIGINAL_COMPANION_SRC, 'walk', 'a')).toBe(false)
})
test('missing and corrupt preferences only read defaults; unavailable identity never writes', () => {
  expect(readPetTransport('p', ORIGINAL_COMPANION_SRC, 'bicycle')?.vehicle).toBe('bicycle')
  storage.set(petTransportStorageKey('a', 'p', ORIGINAL_COMPANION_SRC), { version: 1, appearance: 'another-pet', vehicle: 'scooter' })
  expect(readPetTransport('p', ORIGINAL_COMPANION_SRC, 'bicycle')?.vehicle).toBe('bicycle')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  storage.delete('user_id')
  expect(readPetTransport('p', ORIGINAL_COMPANION_SRC, 'bicycle')).toBeNull()
  expect(savePetTransport(pet, ORIGINAL_COMPANION_SRC, 'scooter', 'a')).toBe(false)
})
test('storage failure preserves the previous choice and never emits success', () => {
  const key = petTransportStorageKey('a', 'p', ORIGINAL_COMPANION_SRC)
  storage.set(key, { version: 1, appearance: ORIGINAL_COMPANION_SRC, vehicle: 'bicycle' })
  ;(Taro.setStorageSync as jest.Mock).mockImplementation(() => { throw new Error('full') })
  expect(savePetTransport(pet, ORIGINAL_COMPANION_SRC, 'skateboard', 'a')).toBe(false)
  expect(readPetTransport('p', ORIGINAL_COMPANION_SRC, 'walk')?.vehicle).toBe('bicycle')
  expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
})
test('a subscriber error does not undo a successfully saved choice', () => {
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementationOnce(() => { throw new Error('subscriber') })
  expect(savePetTransport(pet, ORIGINAL_COMPANION_SRC, 'skateboard', 'a')).toBe(true)
  expect(readPetTransport('p', ORIGINAL_COMPANION_SRC, 'walk')?.vehicle).toBe('skateboard')
})
test('trial is reversible and free; only confirm saves the selected transport', () => {
  const { container, unmount } = render(<PetTransportPicker pet={pet} sprite={ORIGINAL_COMPANION_SRC} account='a' active canSave={() => true} />)
  fireEvent.click(container.querySelector('#journey-transport-skateboard')!)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'skateboard')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('确认出行工具'))
  expect(readPetTransport('p', ORIGINAL_COMPANION_SRC, 'bicycle')?.vehicle).toBe('skateboard')
  unmount()
  const remount = render(<PetTransportPicker pet={pet} sprite={ORIGINAL_COMPANION_SRC} account='a' active canSave={() => true} />)
  expect(remount.container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'skateboard')
})
test('a stale page or switched account cannot confirm a trial', () => {
  const { container, rerender } = render(<PetTransportPicker pet={pet} account='a' active canSave={() => false} />)
  fireEvent.click(container.querySelector('#journey-transport-scooter')!)
  fireEvent.click(screen.getByText('确认出行工具'))
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  rerender(<PetTransportPicker pet={pet} account='a' active canSave={() => true} />)
  storage.set('user_id', 'b')
  fireEvent.click(screen.getByText('确认出行工具'))
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('没有保存成功')
})
test('photo tool cards are disabled and its own walk remains selectable', () => {
  const { container } = render(<PetTransportPicker pet={photo} account='a' active canSave={() => true} />)
  for (const tool of ['bicycle', 'scooter', 'skateboard']) expect(container.querySelector(`#journey-transport-${tool}`)).toBeDisabled()
  expect(container.querySelector('#journey-transport-walk')).not.toBeDisabled()
  expect(container.querySelector('img')).toHaveAttribute('src', 'my-photo-atlas.png')
})
test('a failed tool image falls back to the same character; a new identity can load its own sheet', () => {
  const { container, rerender } = render(<PetTransportActor pet={pet} sprite={ORIGINAL_COMPANION_SRC} vehicle='skateboard' />)
  fireEvent.error(container.querySelector('img')!)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'walk')
  expect(container.querySelector('img')).toHaveAttribute('src', '/assets/pets/motions/guigui-motion-v1.png')
  rerender(<PetTransportActor pet={pet} vehicle='scooter' active={false} />)
  expect(container.querySelector('.pet-transport-actor')).toHaveClass('is-paused', 'is-scooter')
  expect(container.querySelector('img')).toHaveAttribute('src', '/assets/pets/transport/jianwen-transport-v1.png')
})
test('a failed seated pose removes the bicycle and preserves the same original character', () => {
  const { container } = render(<PetTransportActor pet={pet} sprite={ORIGINAL_COMPANION_SRC} vehicle='bicycle' />)
  fireEvent.error(container.querySelector('img')!)
  expect(container.querySelector('.pet-assistant-ride--fitted')).toBeNull()
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'walk')
  expect(container.querySelector('img')).toHaveAttribute('src', ORIGINAL_COMPANION_SRC)
  const actor = container.querySelector('.pet-actor') as HTMLElement
  expect(parseFloat(actor.style.width) / parseFloat(actor.style.height)).toBeCloseTo(160 / 208)
})
test('walking keeps the exact original wardrobe without following a different companion override', () => {
  storage.set(`pet_loadout_v2:a:p:${encodeURIComponent(ORIGINAL_COMPANION_SRC)}`, { version: 2, appearance: ORIGINAL_COMPANION_SRC, scarf: 'cozy-scarf' })
  const { container } = render(<PetTransportActor pet={pet} sprite={ORIGINAL_COMPANION_SRC} vehicle='walk' />)
  expect(container.querySelector('.pet-actor__scarf')).toHaveAttribute('src', '/assets/pets/clothing/cozy-scarf.png')
  expect(container.querySelector('.pet-motion-atlas__sheet')).toHaveAttribute('src', '/assets/pets/motions/guigui-motion-v1.png')
})
test.each([375, 390, 430])('the %spx viewport scales the whole ride while retaining character proportions', width => {
  ;(Taro.getSystemInfoSync as jest.Mock).mockReturnValueOnce({ windowWidth: width })
  const { container } = render(<PetTransportActor pet={pet} sprite={ORIGINAL_COMPANION_SRC} vehicle='bicycle' size={144} active={false} />)
  const plane = container.querySelector('.pet-transport-actor__plane') as HTMLElement
  const scale = Number(plane.style.transform.match(/scale\(([^)]+)\)/)![1])
  expect(200 * width / 750 * scale).toBeCloseTo(144)
  expect(container.querySelector('.pet-motion-atlas')).toHaveClass('pet-motion-atlas--ride', 'is-coasting')
  expect(container.querySelector('.pet-actor')).toHaveClass('pet-actor--paused')
  expect(container.querySelector('.pet-motion-atlas__sheet')).toHaveAttribute('src', '/assets/pets/motions/guigui-motion-v1.png')
})
test('a failed trial cannot be confirmed; changing tool or retrying creates a fresh preview', () => {
  const { container } = render(<PetTransportPicker pet={pet} sprite={ORIGINAL_COMPANION_SRC} account='a' active canSave={() => true} />)
  fireEvent.click(container.querySelector('#journey-transport-skateboard')!)
  fireEvent.error(container.querySelector('img')!)
  expect(screen.getByText('确认出行工具')).toBeDisabled()
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'walk')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  fireEvent.click(container.querySelector('#journey-transport-skateboard')!)
  expect(screen.getByText('确认出行工具')).not.toBeDisabled()
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'skateboard')
  expect(container.querySelector('.pet-transport-actor__sheet')).toHaveAttribute('src', '/assets/pets/transport/guigui-transport-v1.png')
})
