import * as React from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FloatingPetAssistant } from '../../src/components/FloatingPetAssistant'
import { JIANWEN_COMPANION_SRC } from '../../src/utils/pet-companion-preference'
import type { PetProfile } from '../../src/utils/api'
import { PET_TRANSPORT_CHANGED, petTransportStorageKey } from '../../src/utils/pet-transport-storage'

let mockWellness = false
jest.mock('../../src/components/InkWellness', () => ({ useInkWellness: () => mockWellness }))
jest.mock('../../src/utils/api', () => ({ getAccessToken: () => 'test-token' }))
jest.mock('../../src/utils/withAuth', () => ({ redirectToLogin: jest.fn() }))
jest.mock('../../src/components/PetChatContent', () => ({ PetChatContent: () => null }))

const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })
const mount = () => render(<FloatingPetAssistant companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
let storage: Map<string, unknown>
let listeners: Map<string, Set<() => void>>

beforeEach(() => {
  jest.clearAllMocks()
  storage = new Map(); listeners = new Map()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(Taro.eventCenter.on as jest.Mock).mockImplementation((event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback) })
  ;(Taro.eventCenter.off as jest.Mock).mockImplementation((event, callback) => listeners.get(event)?.delete(callback))
  mockWellness = false
  jest.useFakeTimers()
  // Page visibility callbacks fire after mount in WeChat, not during React render.
  ;(useDidShow as jest.Mock).mockImplementation(() => undefined)
})
afterEach(() => { jest.useRealTimers() })

test('balanced companion rests between short gestures rather than constantly walking or kicking', () => {
  const { container } = mount()
  const pet = container.querySelector('#home-floating-pet')!
  advance(1200)
  expect(pet).toHaveClass('is-idle')
  expect(pet).not.toHaveClass('is-walking')
  advance(5200)
  expect(pet).toHaveClass('is-blink')
  advance(1200)
  expect(pet).toHaveClass('is-idle')
  advance(6500)
  expect(pet).toHaveClass('is-look')
})

test('a user kick finishes before another play can count and returns to idle', () => {
  const { container } = mount()
  const play = container.querySelector('#pet-assistant-daily-play')!
  fireEvent.click(play)
  fireEvent.click(play)
  expect(screen.getByText('1/3')).toBeInTheDocument()
  expect(container.querySelector('#home-floating-pet')).toHaveClass('is-kick')
  advance(1200)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('is-idle')
  fireEvent.click(play)
  expect(screen.getByText('2/3')).toBeInTheDocument()
})

test('manual docking leaves a working recall button and does not return automatically', () => {
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('.pet-motion-atlas')).toHaveClass('pet-motion-atlas--ride')
  expect(container.querySelector('.pet-motion-atlas')).toHaveClass('is-coasting')
  expect(container.querySelector('.pet-assistant-ride--fitted')).not.toBeNull()
  expect(container.querySelector('.pet-assistant-rider-limbs')).toBeNull()
  expect(container.querySelector('.pet-assistant-rider-arms')).toBeNull()
  advance(980)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--docked')
  advance(5000)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--docked')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--returning')
  expect(container.querySelector('.pet-motion-atlas')).toHaveClass('pet-motion-atlas--ride')
  advance(1800)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
})

test('wellness retains its existing movement cycle', () => {
  mockWellness = true
  const { container } = mount()
  expect(container.querySelector('.pet-assistant--refined-motion')).toBeNull()
  advance(1200)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('is-walking')
})

test('a photo with no measured seated anchors uses its own walk and no borrowed bicycle or limbs', () => {
  const { container } = render(<FloatingPetAssistant pet={{ id: 'photo', name: '照片伙伴', pet_seed: 'photo', color: 'blue', shape: 'round', pattern: 'none', accessory: 'none', personality: 'gentle', level: 1, experience: 0, level_exp: 0, next_level_exp: 100, level_progress: 0, total_events: 0, avatar_type: 'pixel_self', pixel_avatar_url: 'photo.png', pixel_motion_version: 1, pixel_motion_atlas_url: 'photo-atlas.png' }} onChatOpenChange={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('.pet-motion-atlas')).toHaveClass('pet-motion-atlas--walk')
  expect(container.querySelector('.pet-motion-atlas__sheet')).toHaveAttribute('src', 'photo-atlas.png')
  expect(container.querySelector('.pet-assistant-ride')).toBeNull()
  expect(container.querySelector('.pet-assistant-rider-arms')).toBeNull()
  expect(container.querySelector('.pet-assistant-rider-limbs')).toBeNull()
})
test.each(['scooter', 'skateboard'])('the confirmed %s is used for the actual departure and return', vehicle => {
  storage.set('user_id', 'a')
  storage.set(petTransportStorageKey('a', 'p', JIANWEN_COMPANION_SRC), { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle })
  const { container } = render(<FloatingPetAssistant pet={{ id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', vehicle)
  expect(container.querySelector('.pet-transport-actor__sheet')).toHaveAttribute('src', '/assets/pets/transport/jianwen-transport-v1.png')
  expect(container.querySelector('.pet-assistant-ride--fitted')).toBeNull()
  advance(980)
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', vehicle)
  advance(1800)
  expect(container.querySelector('.pet-transport-actor')).toBeNull()
})
test('changing preference mid-trip waits for the next trip instead of popping a different vehicle', () => {
  storage.set('user_id', 'a')
  const key = petTransportStorageKey('a', 'p', JIANWEN_COMPANION_SRC)
  storage.set(key, { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle: 'skateboard' })
  const { container } = render(<FloatingPetAssistant pet={{ id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  storage.set(key, { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle: 'scooter' })
  act(() => { for (const callback of listeners.get(PET_TRANSPORT_CHANGED) || []) callback() })
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'skateboard')
  advance(980)
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'scooter')
})
