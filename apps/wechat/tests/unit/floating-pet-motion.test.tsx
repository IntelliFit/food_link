import * as React from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FloatingPetAssistant } from '../../src/components/FloatingPetAssistant'
import { JIANWEN_COMPANION_SRC } from '../../src/utils/pet-companion-preference'
import type { PetProfile } from '../../src/utils/api'
import { PET_TRANSPORT_CHANGED, petTransportStorageKey } from '../../src/utils/pet-transport-storage'

let mockWellness = false
let mockDelayReady = false
let mockRigReady: (() => void) | undefined
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
  Object.assign(Taro, { getWindowInfo: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })), hideKeyboard: jest.fn().mockResolvedValue(undefined), onKeyboardHeightChange: jest.fn(), offKeyboardHeightChange: jest.fn() })
  storage = new Map(); listeners = new Map()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(Taro.eventCenter.on as jest.Mock).mockImplementation((event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback) })
  ;(Taro.eventCenter.off as jest.Mock).mockImplementation((event, callback) => listeners.get(event)?.delete(callback))
  mockWellness = false
  mockDelayReady = false; mockRigReady = undefined
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
  expect(container.querySelector('.pet-rig')).toHaveAttribute('data-motion', 'bicycle')
  expect(container.querySelector('.pet-rig')).not.toHaveClass('is-paused')
  expect(container.querySelector('.pet-assistant-rider-limbs')).toBeNull()
  expect(container.querySelector('.pet-assistant-rider-arms')).toBeNull()
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--docked')
  advance(5000)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--docked')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--returning')
  expect(container.querySelector('.pet-rig')).toHaveAttribute('data-motion', 'bicycle')
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
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
  expect(container.querySelector('.pet-rig__source')).toHaveAttribute('src', JIANWEN_COMPANION_SRC)
  expect(container.querySelector('.pet-assistant-ride--fitted')).toBeNull()
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', vehicle)
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-assistant-transport')).toHaveClass('is-standby')
  expect(container.querySelector('.pet-transport-actor')).toHaveClass('is-paused')
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
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'scooter')
})
test('a cold departure waits for the first painted vehicle and then reuses it through docking and recall', () => {
  mockDelayReady = true
  const { container } = mount()
  const transport = container.querySelector('.pet-assistant-transport .pet-rig')!
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  expect(container.querySelector('.pet-assistant-transport')).toHaveAttribute('aria-hidden', 'true')
  act(() => mockRigReady?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  expect(transport).toHaveClass('is-paused')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  expect(container.querySelector('.pet-assistant-transport')).toHaveClass('is-standby')
})

test('automatic recall uses the latest prepared vehicle rather than the departure timer closure', () => {
  storage.set('user_id', 'a')
  const key = petTransportStorageKey('a', 'p', JIANWEN_COMPANION_SRC)
  storage.set(key, { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle: 'bicycle' })
  const ref = React.createRef<any>()
  const { container } = render(<FloatingPetAssistant ref={ref} pet={{ id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
  act(() => ref.current.onPageScroll(20))
  storage.set(key, { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle: 'scooter' })
  act(() => { for (const callback of listeners.get(PET_TRANSPORT_CHANGED) || []) callback() })
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'scooter')
  advance(1820)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--returning')
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'scooter')
})

test('opening and closing chat retains the prepared transport instance and hides it directly', () => {
  const ref = React.createRef<any>()
  const { container } = render(<FloatingPetAssistant ref={ref} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
  const transport = container.querySelector('.pet-assistant-transport .pet-rig')!
  act(() => ref.current.openChat())
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  expect(transport).toHaveAttribute('data-visible', 'false')
  fireEvent.click(container.querySelector('#pet-assistant-chat-mask')!)
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  act(() => ref.current.onPageScroll(20))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
  expect(transport).toHaveAttribute('data-visible', 'true')
})

test('travel finishes on the actual root view event and ignores bubbling child animations', () => {
  const { container } = mount()
  const root = container.querySelector('#home-floating-pet')!
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  advance(1000)
  expect(root).toHaveClass('pet-assistant-float--running')
  fireEvent.transitionEnd(container.querySelector('.pet-assistant-traveler')!)
  expect(root).toHaveClass('pet-assistant-float--running')
  fireEvent.transitionEnd(root)
  expect(root).toHaveClass('pet-assistant-float--docked')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  advance(1850)
  expect(root).toHaveClass('pet-assistant-float--returning')
  fireEvent.animationEnd(root)
  expect(root).toHaveClass('pet-assistant-float--playing')
})

test('a fresh transport owner after suppression does not retain the failed walking geometry', () => {
  const pet = { id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile
  const renderPet = (suppressed: boolean) => <FloatingPetAssistant pet={pet} companionSpriteOverride={JIANWEN_COMPANION_SRC} suppressed={suppressed} onChatOpenChange={jest.fn()} />
  const { container, rerender } = render(renderPet(false))
  const size = (container.querySelector('.pet-assistant-transport') as HTMLElement).style.width
  fireEvent.error(container.querySelector('.pet-assistant-transport .pet-rig__source')!)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'walk')
  rerender(renderPet(true))
  expect(container.querySelector('#home-floating-pet')).toBeNull()
  rerender(renderPet(false))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'bicycle')
  expect((container.querySelector('.pet-assistant-transport') as HTMLElement).style.width).toBe(size)
})

test('an appearance round trip never reuses an old ready callback for a newly mounted canvas', () => {
  const pet = { id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile
  const renderPet = (sprite: string) => <FloatingPetAssistant pet={pet} companionSpriteOverride={sprite} onChatOpenChange={jest.fn()} />
  const { container, rerender } = render(renderPet(JIANWEN_COMPANION_SRC))
  const oldReady = mockRigReady
  mockDelayReady = true
  rerender(renderPet('/assets/pets/companions/companion-fbd87f73-v1.png'))
  rerender(renderPet(JIANWEN_COMPANION_SRC))
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  act(() => oldReady?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  act(() => mockRigReady?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
})

test('a failed appearance can be revisited with fresh riding geometry', () => {
  const pet = { id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile
  const renderPet = (sprite: string) => <FloatingPetAssistant pet={pet} companionSpriteOverride={sprite} onChatOpenChange={jest.fn()} />
  const { container, rerender } = render(renderPet(JIANWEN_COMPANION_SRC))
  const size = (container.querySelector('.pet-assistant-transport') as HTMLElement).style.width
  fireEvent.error(container.querySelector('.pet-assistant-transport .pet-rig__source')!)
  rerender(renderPet('/assets/pets/companions/companion-fbd87f73-v1.png'))
  rerender(renderPet(JIANWEN_COMPANION_SRC))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'bicycle')
  expect((container.querySelector('.pet-assistant-transport') as HTMLElement).style.width).toBe(size)
})

test('returning from wellness waits for its newly mounted transport owner', () => {
  const renderPet = () => <FloatingPetAssistant companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />
  const { container, rerender } = render(renderPet())
  mockWellness = true
  rerender(renderPet())
  mockDelayReady = true; mockWellness = false
  rerender(renderPet())
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  act(() => mockRigReady?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
})

test('switching modes cancels the previous journey timers', () => {
  const ref = React.createRef<any>()
  const renderPet = () => <FloatingPetAssistant ref={ref} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />
  const { container, rerender } = render(renderPet())
  act(() => ref.current.onPageScroll(20))
  advance(400)
  mockWellness = true; rerender(renderPet())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  advance(5000)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  mockWellness = false; rerender(renderPet())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
})

jest.mock('../../src/components/PetRigActor', () => ({ PetRigActor: ({ rig, vehicle, action, active, visible, onReady, onUnavailable }: any) => {
  const React = require('react')
  if (onReady) mockRigReady = onReady
  React.useLayoutEffect(() => { if (!mockDelayReady) onReady?.() }, [rig, vehicle])
  return React.createElement('div', { className: `pet-rig${active ? '' : ' is-paused'}`, 'data-source': rig.src, 'data-motion': vehicle || action, 'data-visible': String(visible) }, React.createElement('img', { className: 'pet-rig__source', src: rig.src, onError: onUnavailable }))
} }))
